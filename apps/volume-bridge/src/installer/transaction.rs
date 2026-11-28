use std::{
	fs,
	path::{Path, PathBuf},
	thread,
	time::Duration,
};

use crate::installer::{
	DRIVER, LAUNCH_FILE, PROXY_UID, ROOT, Result, TRANSACTION, host,
	model::{self, Snapshot},
};

const OWNED: [(&str, &str); 3] =
	[(ROOT, "runtime"), (DRIVER, "driver"), (LAUNCH_FILE, "launch.plist")];
const MARKER: &str = "VolumeBridge installation transaction v1";

pub(super) fn begin(snapshot: &Snapshot) -> Result<()> {
	let transaction = Path::new(TRANSACTION);

	create(transaction)?;

	for (path, backup) in OWNED {
		if Path::new(path).exists() {
			host::copy(Path::new(path), &transaction.join(backup))?;
		}
	}

	host::write_json(&transaction.join("journal.json"), snapshot)
}

pub(super) fn recover() -> Result<()> {
	let transaction = Path::new(TRANSACTION);

	if !transaction.exists() {
		return Ok(());
	}
	if fs::read_to_string(transaction.join("owner"))? != MARKER {
		return Err("An unknown installation transaction directory exists.".into());
	}
	if transaction.join("journal.json").exists() {
		let snapshot = host::read_json(&transaction.join("journal.json"))?;

		eprintln!("Recovering the previous installation transaction.");

		rollback(&snapshot)?;
	}

	finish()
}

pub(super) fn finish() -> Result<()> {
	retire(Path::new(TRANSACTION))
}

pub(super) fn restore_audio(snapshot: &Snapshot) -> Result<()> {
	let devices = host::devices()?;

	if let Some(previous) = snapshot.devices.iter().find(|device| device.uid == PROXY_UID)
		&& devices.iter().any(|device| device.uid == PROXY_UID)
	{
		host::volume(previous.volume)?;
		host::mute(previous.mute != 0)?;
	}
	if let Some(previous) = snapshot.devices.iter().find(|device| device.default)
		&& let Some(current) = model::saved_output(&devices, &previous.uid)
	{
		host::audio("select", &current.uid, None)?;
	}
	if let Some(previous) = snapshot.devices.iter().find(|device| device.system_default)
		&& let Some(current) = model::saved_output(&devices, &previous.uid)
	{
		host::audio("select-system", &current.uid, None)?;
	}

	Ok(())
}

pub(super) fn rollback(snapshot: &Snapshot) -> Result<()> {
	// Restore hardware before a physical output can receive unattenuated audio.
	if host::devices()?.iter().any(|device| device.uid == PROXY_UID) {
		host::mute(true)?;
	}

	host::hardware(&snapshot.target_uid, Some(snapshot.hardware))?;
	host::stop_service()?;

	for (path, backup) in OWNED {
		host::remove(Path::new(path))?;

		let saved = Path::new(TRANSACTION).join(backup);

		if saved.exists() {
			host::copy(&saved, Path::new(path))?;
		}
	}

	if Path::new(LAUNCH_FILE).exists() {
		host::run("/bin/launchctl", &["bootstrap", "system", LAUNCH_FILE])?;
	}

	host::restart_audio()?;

	if Path::new(LAUNCH_FILE).exists() && Path::new(DRIVER).exists() {
		host::wait_for_proxy()?;
	} else {
		thread::sleep(Duration::from_secs(2));
	}

	restore_audio(snapshot)
}

// mktemp creates a private directory on the same volume as the journal.
fn staging_directory(transaction: &Path) -> Result<PathBuf> {
	let template = transaction.with_extension("XXXXXXXX");

	Ok(host::capture(
		Path::new("/usr/bin/mktemp"),
		&["-d", template.to_str().ok_or("Invalid transaction path.")?],
	)?
	.into())
}

fn create(transaction: &Path) -> Result<()> {
	if transaction.try_exists()? {
		return Err("An installation transaction already exists.".into());
	}

	let staging = staging_directory(transaction)?;
	let result =
		fs::write(staging.join("owner"), MARKER).and_then(|()| fs::rename(&staging, transaction));

	if result.is_err() {
		host::remove(&staging)?;
	}

	Ok(result?)
}

fn retire(transaction: &Path) -> Result<()> {
	let staging = staging_directory(transaction)?;
	// Remove the journal and backups from recovery as one unit before cleanup.
	let result = fs::rename(transaction, &staging);

	host::remove(&staging)?;

	Ok(result?)
}

#[cfg(test)]
mod tests {
	use std::{env, fs, os::unix::fs::PermissionsExt as _};

	use crate::installer::{
		Result,
		transaction::{self, MARKER},
	};

	#[test]
	fn publishes_and_retires_a_complete_private_directory() -> Result<()> {
		let root = transaction::staging_directory(&env::temp_dir().join("VolumeBridge-test"))?;
		let active = root.join("transaction");

		transaction::create(&active)?;

		assert_eq!(fs::read_to_string(active.join("owner"))?, MARKER);
		assert_eq!(fs::metadata(&active)?.permissions().mode() & 0o777, 0o700);

		fs::write(active.join("journal.json"), "{}")?;

		assert!(transaction::create(&active).is_err());
		assert!(active.join("journal.json").exists());

		transaction::retire(&active)?;

		assert!(fs::read_dir(&root)?.next().is_none());

		fs::remove_dir(root)?;

		Ok(())
	}
}
