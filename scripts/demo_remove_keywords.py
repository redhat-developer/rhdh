"""
Demo script to remove keywords from ONE package.json file.
This is for demonstration purposes before running the full script.
"""

import json
import sys
from pathlib import Path

def demo_remove_keywords():
    # Target the first file for demo
    target_file = Path("dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-adoption-insights-backend-dynamic/package.json")
    
    if not target_file.exists():
        print(f"❌ File not found: {target_file}")
        sys.exit(1)
    # Read current content
    with open(target_file, 'r') as f:
        content = f.read()
        data = json.loads(content)
    
    print("📋 BEFORE:")
    if 'keywords' in data:
        print(f"   keywords: {data['keywords']}")
    else:
        print("   No keywords found")
    
    # Process keywords
    if 'keywords' not in data:
        print("\n✅ No keywords to remove")
        return
    
    original_keywords = data['keywords'].copy()
    filtered_keywords = []
    removed_keywords = []
    
    for keyword in original_keywords:
        if keyword.startswith('support:') or keyword.startswith('lifecycle:'):
            removed_keywords.append(keyword)
        else:
            filtered_keywords.append(keyword)
    
    if not removed_keywords:
        print("\n✅ No support/lifecycle keywords to remove")
        return
    
    # Update the file
    if filtered_keywords:
        data['keywords'] = filtered_keywords
    else:
        del data['keywords']
    
    # Write back
    with open(target_file, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')
    
    print(f"\n📋 AFTER:")
    if filtered_keywords:
        print(f"   keywords: {filtered_keywords}")
    else:
        print("   keywords array removed (was empty)")
    
    print(f"\n✅ CHANGES MADE:")
    print(f"   🗑️  Removed: {removed_keywords}")
    if filtered_keywords:
        print(f"   ✅ Kept: {filtered_keywords}")
    
    print(f"\n💡 File successfully updated!")
    print(f"   Now your team can see that YAML will be the source of truth")

if __name__ == "__main__":
    demo_remove_keywords()
