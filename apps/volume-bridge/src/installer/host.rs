use std::{
	env,
	fs::{self, File, OpenOptions, Permissions},
	io::{ErrorKind, Write as _},
	os::{
		fd::AsRawFd,
		unix::fs::{OpenOptionsExt, PermissionsExt},
	},
	path::{Path, PathBuf},
	process::{self, Command},
	sync::OnceLock,
	thread,
	time::{Duration, Instant},
};

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

use crate::installer::{
	BINARY, LABEL, PROXY_UID, Result,
	model::{Device, HardwareVolume},
};

unsafe extern "C" {
	fn geteuid() -> u32;
	fn flock(fd: i32, operation: i32) -> i32;
}

static DESKTOP: OnceLock<Desktop> = OnceLock::new();

pub(super) struct Session {
	_lock: File,
	directory: PathBuf,
}
impl Drop for Session {
	fn drop(&mut self) {
		let _ = fs::remove_dir_all(&self.directory);
	}
}

struct Desktop {
	uid: String,
	user: String,
	helper: PathBuf,
}

pub(super) fn root_lock() -> Result<Session> {
	// SAFETY: geteuid has no arguments or pointer requirements.
	if unsafe { geteuid() } != 0 {
		return Err("Use the macOS Installer, or run this command as an administrator.".into());
	}

	let file = OpenOptions::new()
		.create(true)
		.truncate(false)
		.read(true)
		.write(true)
		.mode(0o600)
		.open("/var/run/com.acgbox.volumebridge.installer.lock")?;

	// SAFETY: The file descriptor is owned by file and remains open for the transaction.
	if unsafe { flock(file.as_raw_fd(), 2 | 4) } != 0 {
		return Err("Another VolumeBridge installation is in progress.".into());
	}

	let (uid, user) = console_user()?;
	// PackageKit script directories need not be readable by the console user.
	// Copy only this signed executable to a root-owned, temporary runnable path.
	let directory = PathBuf::from(format!("/var/run/VolumeBridge-Installer-{}", process::id()));

	fs::create_dir(&directory)?;

	mkdir(&directory, 0o755)?;

	let session = Session { _lock: file, directory };
	let helper = session.directory.join("volume-bridge");

	fs::copy(env::current_exe()?, &helper)?;
	fs::set_permissions(&helper, Permissions::from_mode(0o755))?;

	DESKTOP
		.set(Desktop { uid: uid.to_string(), user, helper })
		.map_err(|_| "Desktop session already initialized")?;

	Ok(session)
}

pub(super) fn capture(program: &Path, args: &[&str]) -> Result<String> {
	let output = Command::new(program).args(args).output()?;

	if !output.status.success() {
		return Err(format!(
			"{} failed: {}",
			program.display(),
			String::from_utf8_lossy(&output.stderr).trim()
		)
		.into());
	}

	Ok(String::from_utf8(output.stdout)?.trim().to_owned())
}

pub(super) fn run(program: &str, args: &[&str]) -> Result<()> {
	capture(Path::new(program), args).map(|_| ())
}

pub(super) fn cli(args: &[&str]) -> Result<String> {
	let desktop = DESKTOP.get().ok_or("Desktop session is unavailable")?;

	user_capture(&desktop.helper, args)
}

pub(super) fn devices() -> Result<Vec<Device>> {
	Ok(serde_json::from_str(&cli(&["devices"])?)?)
}

pub(super) fn hardware(uid: &str, value: Option<u32>) -> Result<u32> {
	let text = match value {
		Some(value) => cli(&["monitor-volume", uid, &value.to_string()])?,
		None => cli(&["monitor-volume", uid])?,
	};
	let reading: HardwareVolume = serde_json::from_str(&text)?;

	if reading.maximum != 100 || reading.hardware_volume > 100 {
		return Err("The display did not report a supported hardware volume range.".into());
	}
	if value.is_some_and(|expected| expected != reading.hardware_volume) {
		return Err("The display did not confirm the requested volume.".into());
	}

	Ok(reading.hardware_volume)
}

pub(super) fn audio(command: &str, uid: &str, value: Option<&str>) -> Result<()> {
	let mut args = vec![command, uid];

	if let Some(value) = value {
		args.push(value);
	}

	cli(&args)?;

	Ok(())
}

pub(super) fn mute(value: bool) -> Result<()> {
	audio("mute", PROXY_UID, Some(if value { "1" } else { "0" }))
}

pub(super) fn volume(value: f32) -> Result<()> {
	audio("volume", PROXY_UID, Some(&value.to_string()))
}

pub(super) fn console_user() -> Result<(u32, String)> {
	let uid: u32 = capture(Path::new("/usr/bin/stat"), &["-f", "%u", "/dev/console"])?.parse()?;

	if uid < 501 {
		return Err("Sign in to the Mac desktop before installation.".into());
	}

	let user = capture(Path::new("/usr/bin/id"), &["-nu", &uid.to_string()])?;

	Ok((uid, user))
}

pub(super) fn mkdir(path: &Path, mode: u32) -> Result<()> {
	fs::create_dir_all(path)?;
	fs::set_permissions(path, Permissions::from_mode(mode))?;

	Ok(())
}

pub(super) fn write_json<T>(path: &Path, value: &T) -> Result<()>
where
	T: Serialize,
{
	let temporary = path.with_extension("new");
	let mut file =
		OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&temporary)?;

	file.write_all(&serde_json::to_vec_pretty(value)?)?;
	file.sync_all()?;

	fs::rename(temporary, path)?;

	Ok(())
}

pub(super) fn read_json<T>(path: &Path) -> Result<T>
where
	T: DeserializeOwned,
{
	Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub(super) fn copy(source: &Path, destination: &Path) -> Result<()> {
	let status = Command::new("/usr/bin/ditto").arg(source).arg(destination).status()?;

	if !status.success() {
		return Err("Cannot copy the installation payload.".into());
	}

	Ok(())
}

pub(super) fn remove(path: &Path) -> Result<()> {
	match fs::symlink_metadata(path) {
		Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path)?,
		Ok(_) => fs::remove_file(path)?,
		Err(error) if error.kind() == ErrorKind::NotFound => {},
		Err(error) => return Err(error.into()),
	}

	Ok(())
}

pub(super) fn stop_service() -> Result<()> {
	let target = format!("system/{LABEL}");

	if Command::new("/bin/launchctl").args(["print", &target]).output()?.status.success() {
		run("/bin/launchctl", &["bootout", &target])?;
	}

	let deadline = Instant::now() + Duration::from_secs(5);

	while Command::new("/bin/launchctl").args(["print", &target]).output()?.status.success() {
		if Instant::now() >= deadline {
			return Err("The previous service did not stop.".into());
		}

		thread::sleep(Duration::from_millis(100));
	}

	Ok(())
}

pub(super) fn restart_audio() -> Result<()> {
	run("/usr/bin/killall", &["coreaudiod"])
}

pub(super) fn wait_for_proxy() -> Result<()> {
	let deadline = Instant::now() + Duration::from_secs(25);

	while Instant::now() < deadline {
		if devices()?.iter().any(|device| device.uid == PROXY_UID) {
			let reply = user_capture(Path::new(BINARY), &["status"])?;
			let status: Value = serde_json::from_str(&reply)?;

			if status["driver_connected"].as_u64() == Some(1) {
				return Ok(());
			}
		}

		thread::sleep(Duration::from_millis(250));
	}

	Err("The audio driver did not become ready. The previous installation will be restored.".into())
}

fn user_capture(program: &Path, args: &[&str]) -> Result<String> {
	let desktop = DESKTOP.get().ok_or("Desktop session is unavailable")?;
	let path = program.to_string_lossy();
	let mut command =
		vec!["asuser", &desktop.uid, "/usr/bin/sudo", "-u", &desktop.user, "--", &path];

	command.extend_from_slice(args);

	capture(Path::new("/bin/launchctl"), &command)
}
