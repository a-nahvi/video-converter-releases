use base64::{Engine, engine::general_purpose::STANDARD};
use minisign::{PublicKeyBox, SecretKeyBox};
use std::{env, error::Error, fs, fs::File, io::BufReader, path::PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args_os().skip(1);
    let installer = PathBuf::from(args.next().ok_or("missing installer path")?);
    let version = args.next().ok_or("missing signed version")?;
    let version = version.to_str().ok_or("invalid version")?;
    let filename = installer
        .file_name()
        .ok_or("missing filename")?
        .to_string_lossy();

    let secret_encoding = STANDARD.decode(env::var("TAURI_SIGNING_PRIVATE_KEY")?.trim())?;
    let secret = SecretKeyBox::from_string(std::str::from_utf8(&secret_encoding)?)?
        .into_secret_key(Some(String::new()))?;
    let public_encoding = STANDARD.decode(env::var("VC_UPDATER_PUBLIC_KEY")?.trim())?;
    let public =
        PublicKeyBox::from_string(std::str::from_utf8(&public_encoding)?)?.into_public_key()?;
    let data = BufReader::new(File::open(&installer)?);
    let comment = format!("version:{version}\tfile:{filename}");
    let signature = minisign::sign(Some(&public), &secret, data, Some(&comment), None)?;
    fs::write(
        installer.with_added_extension("sig"),
        STANDARD.encode(signature.to_string()),
    )?;
    Ok(())
}
