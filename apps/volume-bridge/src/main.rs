//! Headless VolumeBridge service and local diagnostic commands.

use std::{
	env,
	ffi::{CString, c_char, c_int},
	process::ExitCode,
	sync::atomic::{AtomicBool, Ordering},
	thread,
	time::{Duration, Instant},
};

use volume_bridge::{self, Route};

static STOP: AtomicBool = AtomicBool::new(false);

#[repr(C)]
#[derive(Default)]
struct Snapshot {
	default_output: u32,
	proxy: u32,
	target: u32,
	builtin: u32,
	sleeping: u32,
	driver_connected: u32,
	source_active: u32,
	reserved: u32,
	wake_count: u64,
	driver_generation: u64,
	output_callbacks: u64,
	output_frames: u64,
	source_frames: u64,
	queued_frames: u64,
	underruns: u64,
	resyncs: u64,
	dropped_frames: u64,
	source_peak_million: u64,
	output_peak_million: u64,
}

unsafe extern "C" {
	fn bridge_initialize(target_uid: *const c_char) -> c_int;
	fn bridge_snapshot() -> Snapshot;
	fn bridge_wait(milliseconds: u32);
	fn bridge_set_running(target_id: u32, running: c_int) -> c_int;
	fn bridge_publish_available(available: c_int);
	fn bridge_shutdown();
	fn bridge_select(device_id: u32) -> c_int;
	fn bridge_command(argc: c_int, argv: *const *const c_char) -> c_int;
	fn signal(number: c_int, handler: extern "C" fn(c_int)) -> usize;
}

extern "C" fn stop_signal(_: c_int) {
	STOP.store(true, Ordering::Relaxed);
}

fn serve(target: &str) -> Result<(), String> {
	let target = CString::new(target).map_err(|error| error.to_string())?;
	// SAFETY: The string lives through initialization; callbacks belong to the native adapter.
	let status = unsafe { bridge_initialize(target.as_ptr()) };

	if status != 0 {
		return Err(format!("Cannot initialize service: {status}"));
	}

	// SAFETY: The handler only writes a lock-free atomic and has C calling convention.
	unsafe {
		signal(2, stop_signal);
		signal(15, stop_signal);
	}

	eprintln!("VolumeBridge service ready");

	run_loop();

	// SAFETY: The controller has stopped issuing native operations.
	unsafe { bridge_shutdown() };

	Ok(())
}

fn run_loop() {
	let mut running = 0;
	let mut generation = (0, 0);
	let mut last_present: Option<Instant> = None;
	let mut wake_deadline: Option<Instant> = None;
	let mut previous_state = None;

	while !STOP.load(Ordering::Relaxed) {
		// SAFETY: All native state transitions run on this control thread.
		let state = unsafe { bridge_snapshot() };

		if state.target != 0 {
			last_present = Some(Instant::now());
		}
		if state.wake_count != generation.0 {
			wake_deadline = Some(Instant::now() + Duration::from_secs(15));
		}

		let available = state.target != 0
			|| last_present.is_some_and(|time| time.elapsed() < Duration::from_secs(3))
			|| wake_deadline.is_some_and(|deadline| Instant::now() < deadline)
			|| state.sleeping != 0;
		let route = Route {
			selected: state.default_output,
			proxy: state.proxy,
			target: state.target,
			connected: state.driver_connected != 0,
			source_active: state.source_active != 0,
			sleeping: state.sleeping != 0,
		};
		let next_generation = (state.wake_count, state.driver_generation);

		if generation != next_generation {
			// SAFETY: Stop waits for the native I/O callback to finish.
			unsafe { bridge_set_running(0, 0) };

			running = 0;
			generation = next_generation;
		}

		let desired = if volume_bridge::should_relay(route) { state.target } else { 0 };

		if running != desired {
			// SAFETY: The target came from the configured UID and validated transport.
			let status = unsafe { bridge_set_running(desired, i32::from(desired != 0)) };

			if status == 0 {
				running = desired;

				eprintln!(
					"relay target={running} wake={} generation={}",
					generation.0, generation.1
				);
			} else {
				eprintln!("relay start failed: {status}");

				thread::sleep(Duration::from_secs(1));
			}
		}

		// SAFETY: These operations run outside the real-time audio callback.
		unsafe { bridge_publish_available(i32::from(available)) };

		if !available
			&& state.proxy != 0
			&& state.default_output == state.proxy
			&& state.builtin != 0
		{
			// SAFETY: The built-in device is a currently enumerated output.
			unsafe { bridge_select(state.builtin) };
		}

		let current = (state.default_output, state.target, state.sleeping, state.driver_connected);

		if previous_state != Some(current) {
			eprintln!(
				"route default={} target={} sleeping={} connected={}",
				current.0, current.1, current.2, current.3
			);

			previous_state = Some(current);
		}

		// SAFETY: Native events wake this bounded control-thread wait.
		unsafe { bridge_wait(200) };
	}
}

fn execute(arguments: &[String]) -> Result<(), String> {
	if arguments.get(1).is_some_and(|value| value == "--version") {
		println!("{}", env!("CARGO_PKG_VERSION"));

		return Ok(());
	}
	if arguments.get(1).is_some_and(|value| value == "serve") {
		if arguments.len() != 4 || arguments[2] != "--target-uid" {
			return Err("usage: volume-bridge serve --target-uid UID".into());
		}

		return serve(&arguments[3]);
	}

	let strings = arguments
		.iter()
		.map(|value| CString::new(value.as_str()))
		.collect::<Result<Vec<_>, _>>()
		.map_err(|error| error.to_string())?;
	let pointers: Vec<_> = strings.iter().map(|value| value.as_ptr()).collect();
	let count = c_int::try_from(pointers.len()).map_err(|error| error.to_string())?;
	// SAFETY: Strings and the pointer array live until this synchronous command returns.
	let status = unsafe { bridge_command(count, pointers.as_ptr()) };

	if status == 0 { Ok(()) } else { Err(format!("Command failed: {status}")) }
}

fn main() -> ExitCode {
	match execute(&env::args().collect::<Vec<_>>()) {
		Ok(()) => ExitCode::SUCCESS,
		Err(error) => {
			eprintln!("{error}");

			ExitCode::FAILURE
		},
	}
}
