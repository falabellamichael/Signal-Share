import os

file_path = 'hero-media-player.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

target = """      if (canUseDesktopBridge()) {
        return performDesktopAction("open_uri", { uri });
      }
      return false;"""

replacement = """      if (canUseDesktopBridge()) {
        return performDesktopAction("open_uri", { uri });
      }
      if (uri) {
        window.open(uri, "_blank");
        return true;
      }
      return false;"""

if target in content:
    new_content = content.replace(target, replacement)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Success: Replacement made.")
else:
    # Try with different line endings just in case
    target_crlf = target.replace('\n', '\r\n')
    if target_crlf in content:
        new_content = content.replace(target_crlf, replacement.replace('\n', '\r\n'))
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Success: Replacement made (CRLF).")
    else:
        print("Error: Target content not found.")
