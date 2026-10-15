//! Link the repository-built Apple SDK adapter.
use std::{env, path::PathBuf};

fn main() {
	let root =
		PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("Cargo sets CARGO_MANIFEST_DIR"));
	let native = root.join("../../target/native");

	println!("cargo:rustc-link-search=native={}", native.display());
	println!("cargo:rustc-link-lib=static=bridge_native");
	println!("cargo:rustc-link-lib=c++");

	for framework in ["CoreAudio", "CoreFoundation", "Foundation", "Security", "IOKit"] {
		println!("cargo:rustc-link-lib=framework={framework}");
	}

	println!("cargo:rerun-if-changed={}", native.join("libbridge_native.a").display());
}
