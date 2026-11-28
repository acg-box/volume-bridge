use serde::{Deserialize, Serialize};

use crate::{
	display,
	installer::{PROXY_UID, Result},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct Device {
	pub id: u32,
	pub uid: String,
	pub name: String,
	pub channels: u32,
	pub transport: u32,
	pub default: bool,
	#[serde(default)]
	pub system_default: bool,
	pub volume: f32,
	pub mute: u32,
}
impl Device {
	fn is_supported_display(&self) -> bool {
		self.name == "LG ULTRAGEAR+" && self.channels == 2 && self.transport == 1_685_090_932
	}
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InstallState {
	pub version: u32,
	pub uid: u32,
	pub user: String,
	#[serde(rename = "targetUID")]
	pub target_uid: String,
	#[serde(rename = "originalOutputUID")]
	pub original_output_uid: String,
	#[serde(rename = "originalSystemOutputUID")]
	pub original_system_output_uid: Option<String>,

	pub original_hardware_volume: Option<u32>,
}
impl InstallState {
	pub fn validate(&self) -> Result<()> {
		if self.version != 1
			|| self.uid < 501
			|| self.user.is_empty()
			|| self.target_uid.is_empty()
			|| self.target_uid == PROXY_UID
			|| self.original_hardware_volume.is_some_and(|value| value > 100)
		{
			return Err("The installation receipt is invalid. No files were removed.".into());
		}

		Ok(())
	}
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct Snapshot {
	pub devices: Vec<Device>,
	pub target_uid: String,
	pub hardware: u32,
	pub had_install: bool,
}

#[derive(Deserialize)]
pub(super) struct HardwareVolume {
	pub hardware_volume: u32,
	pub maximum: u32,
}

pub(super) fn target(devices: &[Device]) -> Result<&Device> {
	let mut matches = devices.iter().filter(|device| device.is_supported_display());
	let device = matches.next().ok_or("Connect the LG ULTRAGEAR+ display before installation.")?;

	if matches.next().is_some() {
		return Err("Connect only one supported LG display for installation.".into());
	}

	Ok(device)
}

pub(super) fn saved_output<'a>(devices: &'a [Device], uid: &str) -> Option<&'a Device> {
	let mut matches = devices.iter().filter(|device| {
		device.uid == uid || (device.is_supported_display() && display::same_uid(&device.uid, uid))
	});
	let device = matches.next()?;

	matches.next().is_none().then_some(device)
}

#[cfg(test)]
mod tests {
	use crate::installer::model::{self, Device, InstallState};

	#[test]
	fn restore_the_saved_output_only_when_unambiguous() {
		let uid = "11111111-2222-3333-4444-555555555555";
		let mut devices = vec![Device {
			id: 2,
			uid: format!("{uid}_00000002"),
			name: "LG ULTRAGEAR+".into(),
			channels: 2,
			transport: 1_685_090_932,
			default: false,
			system_default: false,
			volume: 0.0,
			mute: 0,
		}];

		assert_eq!(model::saved_output(&devices, uid).map(|device| device.id), Some(2));

		devices.push(Device { id: 3, uid: uid.into(), ..devices[0].clone() });

		assert!(model::saved_output(&devices, uid).is_none());
	}

	#[test]
	fn the_existing_prototype_receipt_remains_readable() {
		let receipt: InstallState = serde_json::from_str(
			r#"{
            "version":1,"uid":501,"user":"tester","targetUID":"lg-test",
            "originalOutputUID":"BuiltInSpeakerDevice","originalHardwareVolume":5
        }"#,
		)
		.expect("valid legacy receipt");

		receipt.validate().expect("valid ownership");

		assert_eq!(receipt.original_hardware_volume, Some(5));
		assert_eq!(receipt.original_system_output_uid, None);
	}
}
