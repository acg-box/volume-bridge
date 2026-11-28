use std::ffi::{CStr, c_char};

pub(crate) fn same_uid(left: &str, right: &str) -> bool {
	identity(left) == identity(right)
}

/// Core Audio can append an eight-digit hexadecimal port suffix to the EDID UUID.
fn identity(uid: &str) -> &str {
	let Some((uuid, port)) = uid.split_once('_') else {
		return uid;
	};
	let is_uuid = uuid.len() == 36
		&& uuid.bytes().enumerate().all(|(i, byte)| match i {
			8 | 13 | 18 | 23 => byte == b'-',
			_ => byte.is_ascii_hexdigit(),
		});

	if is_uuid && port.len() == 8 && port.bytes().all(|byte| byte.is_ascii_hexdigit()) {
		uuid
	} else {
		uid
	}
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bridge_same_display_uid(left: *const c_char, right: *const c_char) -> bool {
	// SAFETY: Both native callers pass live, NUL-terminated UID strings.
	let (left, right) = unsafe { (CStr::from_ptr(left), CStr::from_ptr(right)) };

	matches!((left.to_str(), right.to_str()), (Ok(left), Ok(right)) if same_uid(left, right))
}

#[cfg(test)]
mod tests {
	use crate::display;

	#[test]
	fn display_identity_survives_a_port_change() {
		let uuid = "11111111-2222-3333-4444-555555555555";
		let port_a = format!("{uuid}_0000000a");
		let port_b = format!("{uuid}_0000000B");

		assert!(display::same_uid(uuid, &port_a));
		assert!(display::same_uid(&port_a, uuid));
		assert!(display::same_uid(&port_a, &port_b));
		assert!(!display::same_uid(&port_a, "11111111-2222-3333-4444-666666666666_0000000a"));
		assert!(!display::same_uid(uuid, &format!("{uuid}_0000000x")));
		assert!(!display::same_uid(uuid, &format!("{uuid}_0000000a_extra")));
		assert!(!display::same_uid("other", "other_0000000a"));
	}
}
