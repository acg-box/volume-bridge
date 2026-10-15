//! Route policy for the VolumeBridge headless audio service.

/// Current output routing and driver state.
#[derive(Clone, Copy)]
pub struct Route {
	/// Current default output ID.
	pub selected: u32,
	/// VolumeBridge output ID, or zero when absent.
	pub proxy: u32,
	/// Configured physical output ID, or zero when absent.
	pub target: u32,
	/// Whether the authenticated driver connection is ready.
	pub connected: bool,
	/// Whether a client is writing to the proxy.
	pub source_active: bool,
	/// Whether the system is entering sleep.
	pub sleeping: bool,
}

/// Return whether this route requires physical audio rendering.
#[must_use]
pub const fn should_relay(route: Route) -> bool {
	route.proxy != 0
		&& route.target != 0
		&& route.selected == route.proxy
		&& route.connected
		&& route.source_active
		&& !route.sleeping
}

#[cfg(test)]
mod tests {
	use crate::Route;

	fn selected() -> Route {
		Route {
			selected: 7,
			proxy: 7,
			target: 8,
			connected: true,
			source_active: true,
			sleeping: false,
		}
	}

	#[test]
	fn switch_to_another_output_stops_relay() {
		assert!(crate::should_relay(selected()));
		assert!(!crate::should_relay(Route { selected: 9, ..selected() }));
		assert!(crate::should_relay(selected()));
	}

	#[test]
	fn missing_driver_target_or_source_stops_relay() {
		assert!(!crate::should_relay(Route { connected: false, ..selected() }));
		assert!(!crate::should_relay(Route { target: 0, ..selected() }));
		assert!(!crate::should_relay(Route { source_active: false, ..selected() }));
		assert!(!crate::should_relay(Route { proxy: 0, selected: 0, ..selected() }));
	}

	#[test]
	fn wake_does_not_override_another_output() {
		assert!(!crate::should_relay(Route { sleeping: true, ..selected() }));
		assert!(crate::should_relay(selected()));
		assert!(!crate::should_relay(Route { selected: 9, sleeping: false, ..selected() }));
	}
}
