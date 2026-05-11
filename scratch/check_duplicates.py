import re

def find_duplicates(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Match function, let, const, var declarations
    patterns = [
        r'function\s+([a-zA-Z0-9_]+)',
        r'const\s+([a-zA-Z0-9_]+)\s*=',
        r'let\s+([a-zA-Z0-9_]+)\s*=',
        r'var\s+([a-zA-Z0-9_]+)\s*='
    ]

    seen = {}
    duplicates = []

    for pattern in patterns:
        for match in re.finditer(pattern, content):
            name = match.group(1)
            line_num = content.count('\n', 0, match.start()) + 1
            if name in seen:
                duplicates.append((name, seen[name], line_num))
            else:
                seen[name] = line_num

    if duplicates:
        print("Found duplicate declarations:")
        for name, first, second in duplicates:
            print(f"  - {name}: Line {first} and Line {second}")
    else:
        print("No duplicate declarations found.")

find_duplicates(r'c:\Users\Falab\OneDrive\Documents\Website Project\app-v3.js')
