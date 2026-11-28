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

/// Select the change required by the currently running physical output.
pub fn relay_change(route: Route, running: u32) -> Option<u32> {
	let desired = if should_relay(route) { route.target } else { 0 };

	(desired != running).then_some(desired)
}

#[cfg(test)]
mod tests {
	use crate::route::{self, Route};

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
		assert!(route::should_relay(selected()));
		assert!(!route::should_relay(Route { selected: 9, ..selected() }));
		assert!(route::should_relay(selected()));
	}

	#[test]
	fn missing_driver_target_or_source_stops_relay() {
		assert!(!route::should_relay(Route { connected: false, ..selected() }));
		assert!(!route::should_relay(Route { target: 0, ..selected() }));
		assert!(!route::should_relay(Route { source_active: false, ..selected() }));
		assert!(!route::should_relay(Route { proxy: 0, selected: 0, ..selected() }));
	}

	#[test]
	fn retries_after_a_failed_switch_or_driver_reattach() {
		let original = selected();
		let switched = Route { target: 9, ..original };

		assert_eq!(route::relay_change(switched, original.target), Some(9));
		// Both a failed switch and a new ring leave the native renderer stopped.
		assert_eq!(route::relay_change(original, 0), Some(original.target));
		assert_eq!(route::relay_change(original, original.target), None);
		assert_eq!(route::relay_change(Route { connected: false, ..original }, 8), Some(0));
	}

	#[test]
	fn wake_does_not_override_another_output() {
		assert!(!route::should_relay(Route { sleeping: true, ..selected() }));
		assert!(route::should_relay(selected()));
		assert!(!route::should_relay(Route { selected: 9, sleeping: false, ..selected() }));
	}
}
