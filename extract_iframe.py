
import re

try:
    with open('sejm_dump.html', 'r', encoding='utf-16-le') as f:
        content = f.read()
except UnicodeError:
    with open('sejm_dump.html', 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

print("File len:", len(content))
match = re.search(r'<iframe[^>]*src=["\']([^"\']*)["\']', content, re.IGNORECASE)
if match:
    print("IFRAME SRC:", match.group(1))
else:
    print("No iframe found.")
    print("Preview:", content[:500])
