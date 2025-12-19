import re
import os
from collections import defaultdict

# Check current titles for all frontend/backend pairs
pairs_info = []

for filename in sorted(os.listdir('.')):
    if filename.endswith('.yaml') and filename != 'all.yaml':
        with open(filename, 'r') as f:
            content = f.read()
        
        match = re.search(r'^\s*title:\s*"([^"]*)"', content, re.MULTILINE)
        if match:
            title = match.group(1)
            pairs_info.append((filename, title))

# Group by base name to identify pairs
base_groups = defaultdict(list)
for filename, title in pairs_info:
    # Remove -backend to group pairs
    if filename.endswith('-backend.yaml'):
        base_name = filename[:-13]  # Remove '-backend.yaml'
        base_groups[base_name].append(('backend', filename, title))
    else:
        base_name = filename[:-5]   # Remove '.yaml'
        base_groups[base_name].append(('frontend', filename, title))

# Show pairs that have both frontend and backend
print("📋 CURRENT STATE OF FRONTEND/BACKEND PAIRS:")
print("=" * 70)

true_pairs = []
for base_name, items in base_groups.items():
    if len(items) == 2:  # Has both frontend and backend
        items.sort()  # Sort so backend comes first, frontend second
        backend_info = next((item for item in items if item[0] == 'backend'), None)
        frontend_info = next((item for item in items if item[0] == 'frontend'), None)
        
        if backend_info and frontend_info:
            true_pairs.append((base_name, frontend_info, backend_info))

# Display the pairs
for i, (base_name, frontend_info, backend_info) in enumerate(sorted(true_pairs)[:10]):
    print(f"\n{i+1}. {base_name.replace('backstage-community-plugin-', '').replace('backstage-plugin-', '')}")
    print(f"   Frontend: \"{frontend_info[2]}\" ({frontend_info[1]})")
    print(f"   Backend:  \"{backend_info[2]}\" ({backend_info[1]})")
    
    # Check if they're properly distinguished
    if not (('Frontend' in frontend_info[2] or frontend_info[2].endswith(backend_info[2].replace(' Backend', ''))) 
            and 'Backend' in backend_info[2]):
        print(f"   ⚠️  May need better differentiation")

print(f"\n📊 Found {len(true_pairs)} frontend/backend pairs")
