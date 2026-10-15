use crate::installer::Result;

pub(super) trait Controls {
	fn mute(&mut self, value: bool) -> Result<()>;
	fn volume(&mut self, value: f32) -> Result<()>;
	fn select(&mut self) -> Result<()>;
	fn hardware(&mut self, value: u32) -> Result<()>;
}

pub(super) fn apply(
	controls: &mut impl Controls,
	hardware: u32,
	new_installation: bool,
	volume: f32,
	muted: bool,
) -> Result<()> {
	controls.mute(true)?;
	controls.volume(if new_installation || hardware != 100 { 0.02 } else { volume })?;
	controls.select()?;

	if hardware != 100 {
		controls.hardware(100)?;
	}

	controls.mute(muted)
}

#[cfg(test)]
mod tests {
	use crate::installer::calibration::{Controls, Result};

	#[derive(Default)]
	struct Fake {
		events: Vec<String>,
		fail_hardware: bool,
	}
	impl Controls for Fake {
		fn mute(&mut self, value: bool) -> Result<()> {
			self.events.push(format!("mute:{value}"));

			Ok(())
		}

		fn volume(&mut self, value: f32) -> Result<()> {
			self.events.push(format!("volume:{value}"));

			Ok(())
		}

		fn select(&mut self) -> Result<()> {
			self.events.push("select".into());

			Ok(())
		}

		fn hardware(&mut self, value: u32) -> Result<()> {
			self.events.push(format!("hardware:{value}"));

			if self.fail_hardware {
				return Err("Display disconnected".into());
			}

			Ok(())
		}
	}

	#[test]
	fn full_hardware_volume_requires_mute_and_low_gain_first() {
		let mut io = Fake::default();

		super::apply(&mut io, 5, true, 1.0, false).expect("calibration");

		assert_eq!(io.events, ["mute:true", "volume:0.02", "select", "hardware:100", "mute:false"]);
	}

	#[test]
	fn updates_preserve_volume_without_rewriting_calibrated_hardware() {
		let mut io = Fake::default();

		super::apply(&mut io, 100, false, 0.25, true).expect("update");

		assert_eq!(io.events, ["mute:true", "volume:0.25", "select", "mute:true"]);
	}

	#[test]
	fn failed_hardware_readback_cannot_unmute() {
		let mut io = Fake { fail_hardware: true, ..Fake::default() };

		assert!(super::apply(&mut io, 5, true, 1.0, false).is_err());
		assert!(!io.events.contains(&"mute:false".into()));
	}
}
