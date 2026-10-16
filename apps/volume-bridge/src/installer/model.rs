use serde::{Deserialize, Serialize};

use crate::installer::{PROXY_UID, Result};

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
	let mut matches = devices.iter().filter(|device| {
		device.name == "LG ULTRAGEAR+" && device.channels == 2 && device.transport == 1_685_090_932
	});
	let device = matches.next().ok_or("Connect the LG ULTRAGEAR+ display before installation.")?;

	if matches.next().is_some() {
		return Err("Connect only one supported LG display for installation.".into());
	}

	Ok(device)
}

#[cfg(test)]
mod tests {
	use crate::installer::model::InstallState;

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
