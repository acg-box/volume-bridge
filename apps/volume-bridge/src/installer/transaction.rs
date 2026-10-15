use std::{fs, path::Path, thread, time::Duration};

use crate::installer::{
	DRIVER, LAUNCH_FILE, PROXY_UID, ROOT, Result, TRANSACTION, host, model::Snapshot,
};

const OWNED: [(&str, &str); 3] =
	[(ROOT, "runtime"), (DRIVER, "driver"), (LAUNCH_FILE, "launch.plist")];
const MARKER: &str = "VolumeBridge installation transaction v1";

pub(super) fn begin(snapshot: &Snapshot) -> Result<()> {
	let transaction = Path::new(TRANSACTION);

	fs::create_dir(transaction)?;
	host::mkdir(transaction, 0o700)?;
	fs::write(transaction.join("owner"), MARKER)?;

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
	host::remove(Path::new(TRANSACTION))
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
		&& devices.iter().any(|device| device.uid == previous.uid)
	{
		host::audio("select", &previous.uid, None)?;
	}
	if let Some(previous) = snapshot.devices.iter().find(|device| device.system_default)
		&& devices.iter().any(|device| device.uid == previous.uid)
	{
		host::audio("select-system", &previous.uid, None)?;
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
