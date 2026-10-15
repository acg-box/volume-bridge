//! Native package installation, calibration, and rollback. No development runtime is used.

mod calibration;
mod host;
mod model;
mod transaction;

use std::{
	error::Error,
	fs::{self, Permissions},
	os::unix::fs::PermissionsExt,
	path::Path,
};

use calibration::Controls;
use model::{InstallState, Snapshot};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

const ROOT: &str = "/Library/Application Support/VolumeBridge";
const BINARY: &str = "/Library/Application Support/VolumeBridge/bin/volume-bridge";
const STATE: &str = "/Library/Application Support/VolumeBridge/install-state.json";
const DRIVER: &str = "/Library/Audio/Plug-Ins/HAL/VolumeBridge.driver";
const LABEL: &str = "com.acgbox.volumebridge.service";
const LAUNCH_FILE: &str = "/Library/LaunchDaemons/com.acgbox.volumebridge.service.plist";
const LOGS: &str = "/Library/Logs/VolumeBridge";
const TRANSACTION: &str = "/Library/Application Support/VolumeBridge Transaction";
const PROXY_UID: &str = "com.acgbox.volumebridge.lg-output.v1";

struct Calibration<'a> {
	state: &'a InstallState,
	snapshot: &'a Snapshot,
}
impl Controls for Calibration<'_> {
	fn mute(&mut self, value: bool) -> Result<()> {
		host::mute(value)
	}

	fn volume(&mut self, value: f32) -> Result<()> {
		host::volume(value)
	}

	fn hardware(&mut self, value: u32) -> Result<()> {
		host::hardware(&self.state.target_uid, Some(value)).map(|_| ())
	}

	fn select(&mut self) -> Result<()> {
		let old = self.snapshot.devices.iter().find(|device| device.default);

		if !self.snapshot.had_install
			|| old.is_some_and(|device| {
				device.uid == PROXY_UID || device.uid == self.state.target_uid
			}) {
			host::audio("select", PROXY_UID, None)?;
		} else if let Some(old) = old {
			host::audio("select", &old.uid, None)?;
		}

		Ok(())
	}
}

pub(crate) fn execute(arguments: &[String]) -> std::result::Result<(), String> {
	execute_inner(arguments).map_err(|error| error.to_string())
}

fn execute_inner(arguments: &[String]) -> Result<()> {
	let _lock = host::root_lock()?;

	transaction::recover()?;

	match arguments {
		[action, payload] if action == "install" => install(Path::new(payload)),
		[action] if action == "uninstall" => uninstall(),
		_ => Err("usage: volume-bridge package install PAYLOAD | package uninstall".into()),
	}
}

fn read_state() -> Result<Option<InstallState>> {
	if Path::new(STATE).exists() {
		let state: InstallState = host::read_json(Path::new(STATE))?;

		state.validate()?;

		return Ok(Some(state));
	}
	if [ROOT, DRIVER, LAUNCH_FILE].iter().any(|path| Path::new(path).exists()) {
		return Err(
			"Existing files have no VolumeBridge ownership receipt. No files were changed.".into(),
		);
	}

	Ok(None)
}

fn prepare(payload: &Path) -> Result<(InstallState, Snapshot)> {
	for path in [payload.join("volume-bridge"), payload.join("VolumeBridge.driver")] {
		host::capture(
			Path::new("/usr/bin/codesign"),
			&["--verify", "--strict", &path.to_string_lossy()],
		)?;
	}

	let (uid, user) = host::console_user()?;
	let devices = host::devices()?;
	let target = model::target(&devices)?;
	let hardware = host::hardware(&target.uid, None)?;
	let previous = read_state()?;
	let had_install = previous.is_some();
	let mut state = previous.unwrap_or(InstallState {
		version: 1,
		uid,
		user,
		target_uid: target.uid.clone(),
		original_output_uid: devices
			.iter()
			.find(|device| device.default)
			.ok_or("No default output is available.")?
			.uid
			.clone(),
		original_system_output_uid: devices
			.iter()
			.find(|device| device.system_default)
			.map(|device| device.uid.clone()),
		original_hardware_volume: Some(hardware),
	});

	if state.uid != uid || state.target_uid != target.uid {
		return Err("Use the original user account and display to update this installation.".into());
	}

	state.original_hardware_volume.get_or_insert(hardware);

	let snapshot = Snapshot { target_uid: target.uid.clone(), devices, hardware, had_install };

	Ok((state, snapshot))
}

fn install(payload: &Path) -> Result<()> {
	let (state, snapshot) = prepare(payload)?;

	transaction::begin(&snapshot)?;

	let result = install_files(payload, &state).and_then(|()| configure(&state, &snapshot));

	complete(result, &snapshot)?;

	println!("VolumeBridge is installed. Hardware calibration passed. Use system volume controls.");

	Ok(())
}

fn complete(result: Result<()>, snapshot: &Snapshot) -> Result<()> {
	if let Err(error) = result {
		eprintln!("Installation failed; restoring the previous state: {error}");

		if let Err(recovery) = transaction::rollback(snapshot) {
			return Err(format!("{error}. Recovery needs attention: {recovery}. Keep the display connected and rerun this package.").into());
		}

		transaction::finish()?;

		return Err(format!("{error}. The previous state was restored.").into());
	}

	transaction::finish()
}

fn install_files(payload: &Path, state: &InstallState) -> Result<()> {
	host::stop_service()?;
	host::mkdir(Path::new(ROOT), 0o755)?;
	host::mkdir(&Path::new(ROOT).join("bin"), 0o755)?;
	host::mkdir(Path::new(LOGS), 0o750)?;
	host::copy(&payload.join("volume-bridge"), Path::new(BINARY))?;
	host::remove(&Path::new(ROOT).join("licenses"))?;
	host::copy(&payload.join("licenses"), &Path::new(ROOT).join("licenses"))?;
	host::run("/bin/chmod", &["-R", "a+rX,go-w", &format!("{ROOT}/licenses")])?;
	host::remove(Path::new(DRIVER))?;
	host::copy(&payload.join("VolumeBridge.driver"), Path::new(DRIVER))?;
	fs::set_permissions(BINARY, Permissions::from_mode(0o755))?;
	host::run("/bin/chmod", &["-R", "a+rX,go-w", DRIVER])?;
	host::write_json(Path::new(STATE), state)?;
	host::run("/usr/sbin/chown", &["-R", "root:wheel", ROOT, DRIVER])?;
	host::run("/usr/sbin/chown", &["-R", &format!("{}:staff", state.user), LOGS])?;

	write_launch_file(state)?;

	host::run("/bin/launchctl", &["bootstrap", "system", LAUNCH_FILE])?;
	host::restart_audio()?;

	host::wait_for_proxy()
}

fn write_launch_file(state: &InstallState) -> Result<()> {
	let launch = serde_json::json!({
		"Label": LABEL, "ProgramArguments": [BINARY,"serve","--target-uid",state.target_uid],
		"UserName":state.user, "GroupName":"staff", "RunAtLoad":true,"KeepAlive":true,
		"ThrottleInterval":5,"ProcessType":"Interactive","MachServices":{LABEL:true},
		"StandardOutPath":format!("{LOGS}/service.log"),"StandardErrorPath":format!("{LOGS}/service.log")
	});

	host::write_json(Path::new(LAUNCH_FILE), &launch)?;
	host::run("/usr/bin/plutil", &["-convert", "xml1", LAUNCH_FILE])?;
	fs::set_permissions(LAUNCH_FILE, Permissions::from_mode(0o644))?;

	host::run("/usr/sbin/chown", &["root:wheel", LAUNCH_FILE])
}

fn configure(state: &InstallState, snapshot: &Snapshot) -> Result<()> {
	let previous = snapshot.devices.iter().find(|device| device.uid == PROXY_UID);
	let mut controls = Calibration { state, snapshot };

	calibration::apply(
		&mut controls,
		snapshot.hardware,
		!snapshot.had_install,
		previous.map_or(0.02, |device| device.volume),
		previous.is_some_and(|device| device.mute != 0),
	)?;

	if snapshot.had_install
		&& let Some(system) = snapshot.devices.iter().find(|device| device.system_default)
	{
		host::audio("select-system", &system.uid, None)?;
	}
	if host::hardware(&state.target_uid, None)? != 100 {
		return Err("Final hardware calibration failed.".into());
	}

	Ok(())
}

fn uninstall() -> Result<()> {
	let Some(state) = read_state()? else {
		println!("VolumeBridge is already removed.");

		return Ok(());
	};
	let devices = host::devices()?;
	let hardware = host::hardware(&state.target_uid, None)?;
	let snapshot =
		Snapshot { devices, target_uid: state.target_uid.clone(), hardware, had_install: true };

	if state.original_hardware_volume.is_none() {
		return Err(
			"No original hardware volume is recorded. Removal requires manual recovery.".into()
		);
	}

	transaction::begin(&snapshot)?;

	complete(remove_installation(&state), &snapshot)?;

	println!(
		"VolumeBridge was removed. The original hardware volume and audio output were restored."
	);

	Ok(())
}

fn remove_installation(state: &InstallState) -> Result<()> {
	if host::devices()?.iter().any(|device| device.uid == PROXY_UID) {
		host::mute(true)?;
	}

	host::hardware(&state.target_uid, state.original_hardware_volume)?;

	let devices = host::devices()?;
	let restore = devices
		.iter()
		.find(|device| device.uid == state.original_output_uid)
		.or_else(|| devices.iter().find(|device| device.uid == "BuiltInSpeakerDevice"))
		.ok_or("No output is available to restore.")?;

	host::audio("select", &restore.uid, None)?;

	if let Some(uid) = &state.original_system_output_uid
		&& devices.iter().any(|device| &device.uid == uid)
	{
		host::audio("select-system", uid, None)?;
	}

	host::stop_service()?;

	for path in [LAUNCH_FILE, DRIVER, ROOT] {
		host::remove(Path::new(path))?;
	}

	host::restart_audio()?;
	host::write_json(Path::new("/Library/Logs/VolumeBridge-uninstall.json"), state)?;

	host::remove(Path::new(LOGS))
}
