use std::{path::Path, process::Command};

use base64::{engine::general_purpose, Engine as _};
use regex::Regex;

use std::fs;

use sysinfo::{ProcessExt, System, SystemExt};

pub fn reset_system_network() -> Result<(), Box<dyn std::error::Error>> {
    let dns_conf = "/etc/NetworkManager/conf.d/dns.conf";

    // 系统更新后 dns.conf 可能变成只读，/etc/resolv.conf 可能被加锁
    run_command("chattr", &["-i", "/etc/resolv.conf"]);
    run_command("chmod", &["a+w", dns_conf]);

    //读入程序的 DNS
    let default_config = "[main]\ndns=auto";
    if let Err(e) = fs::write(dns_conf, default_config) {
        log::error!("Failed to write {}: {}", dns_conf, e);
    }

    // 更新 NetworkManager
    run_command("nmcli", &["general", "reload"]);

    // systemd-resolved 会缓存 TUN 生效期间的 fake-ip 解析结果，
    // 重启后才会重新读取 NetworkManager 写入的 DNS，否则会一直无法上网
    if is_service_active("systemd-resolved") {
        run_command("systemctl", &["restart", "systemd-resolved"]);
    }

    log::info!("Successfully reset network");
    Ok(())
}

fn run_command(cmd: &str, args: &[&str]) {
    match Command::new(cmd).args(args).output() {
        Ok(output) => {
            if !output.status.success() {
                log::warn!(
                    "{} {:?} failed: {}",
                    cmd,
                    args,
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
        }
        Err(e) => log::warn!("Failed to run {} {:?}: {}", cmd, args, e),
    }
}

fn is_service_active(name: &str) -> bool {
    match Command::new("systemctl").arg("is-active").arg(name).output() {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

pub fn get_current_working_dir() -> std::io::Result<std::path::PathBuf> {
    std::env::current_dir()
}

pub fn check_yaml(str: &String) -> bool {
    if let Ok(x) = serde_yaml::from_str::<serde_yaml::Value>(str) {
        if let Some(v) = x.as_mapping() {
            if v.contains_key("rules") {
                return true;
            } else {
                return false;
            }
        } else {
            return false;
        }
    } else {
        return false;
    }
}

pub fn is_clash_running() -> bool {
    //关闭 systemd-resolved
    let mut sys = System::new_all();
    sys.refresh_all();
    for (_, process) in sys.processes() {
        if process.name() == "clash" {
            return true;
        }
    }
    return false;
}

pub fn get_file_path(url: String) -> Option<String> {
    let r = Regex::new(r"^file://").unwrap();
    if let Some(x) = r.find(url.clone().as_str()) {
        let file_path = url[x.end()..url.len()].to_string();
        return Some(file_path);
    };
    return None;
}

/// 把 ss:// 链接转成单节点的 mihomo 配置。
/// 只支持不带插件的 SS 链接，其它形式返回 None。
pub fn ss_uri_to_config(uri: &str) -> Option<String> {
    let node = parse_ss_uri(uri)?;
    let config = serde_json::json!({
        "mixed-port": 7890,
        "allow-lan": false,
        "mode": "rule",
        "log-level": "info",
        "proxies": [{
            "name": node.name,
            "type": "ss",
            "server": node.server,
            "port": node.port,
            "cipher": node.cipher,
            "password": node.password,
            "udp": true
        }],
        "proxy-groups": [{
            "name": "PROXY",
            "type": "select",
            "proxies": [node.name, "DIRECT"]
        }],
        "rules": ["MATCH,PROXY"]
    });
    // JSON 是 YAML 的子集，先借 serde_json 转义，再交给 serde_yaml 输出
    let value: serde_yaml::Value = serde_yaml::from_str(&config.to_string()).ok()?;
    serde_yaml::to_string(&value).ok()
}

/// 若 url 是 ss:// 链接，就把配置写到临时文件并返回 `file://` 路径，
/// 由现有的本地文件订阅流程接管；否则返回 None。
pub fn ss_uri_to_local_path(uri: &str) -> Option<String> {
    let node = parse_ss_uri(uri)?;
    let config = ss_uri_to_config(uri)?;
    let path = std::env::temp_dir().join(format!("tomoon-ss-{}-{}.yaml", node.server, node.port));
    match fs::write(&path, config) {
        Ok(_) => Some(format!("file://{}", path.display())),
        Err(e) => {
            log::error!("Failed to write ss config to {:?}: {}", path, e);
            None
        }
    }
}

struct SsNode {
    name: String,
    server: String,
    port: u16,
    cipher: String,
    password: String,
}

fn parse_ss_uri(uri: &str) -> Option<SsNode> {
    let body = uri.trim().strip_prefix("ss://")?;

    // 去掉 #备注 和 ?查询参数
    let (body, tag) = match body.split_once('#') {
        Some((b, t)) => (b, percent_decode(t)),
        None => (body, String::new()),
    };
    let (body, query) = match body.split_once('?') {
        Some((b, q)) => (b, q),
        None => (body, ""),
    };
    if query.contains("plugin=") {
        log::warn!("SS link with plugin is not supported: {}", uri);
        return None;
    }
    let body = body.trim_end_matches('/');

    // SIP002: ss://base64(method:password)@host:port
    // 旧格式: ss://base64(method:password@host:port)
    let decoded = match body.rsplit_once('@') {
        Some((userinfo, host_port)) => format!("{}@{}", base64_decode(userinfo)?, host_port),
        None => base64_decode(body)?,
    };

    let (credential, host_port) = decoded.rsplit_once('@')?;
    let (cipher, password) = credential.split_once(':')?;
    let (server, port) = host_port.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    if server.is_empty() || cipher.is_empty() || password.is_empty() {
        return None;
    }

    let name = if tag.is_empty() {
        format!("ss-{}-{}", server, port)
    } else {
        tag
    };

    Some(SsNode {
        name,
        server: server.to_string(),
        port,
        cipher: cipher.to_string(),
        password: password.to_string(),
    })
}

fn base64_decode(data: &str) -> Option<String> {
    // 兼容 urlsafe 变体和省略了 padding 的链接
    let mut data = data.trim().replace('-', "+").replace('_', "/");
    while data.len() % 4 != 0 {
        data.push('=');
    }
    let bytes = general_purpose::STANDARD.decode(data).ok()?;
    String::from_utf8(bytes).ok()
}

fn percent_decode(data: &str) -> String {
    let bytes = data.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && bytes[i + 1].is_ascii_hexdigit()
            && bytes[i + 2].is_ascii_hexdigit()
        {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap();
            out.push(u8::from_str_radix(hex, 16).unwrap());
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}
