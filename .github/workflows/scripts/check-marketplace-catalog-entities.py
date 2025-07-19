import os
import sys
import yaml

def find_discrepancies():
    packages_path = './catalog-entities/marketplace/packages'
    plugins_path = './catalog-entities/marketplace/plugins'
    warnings_found = False

    plugin_names = set()
    for filename in os.listdir(plugins_path):
        if filename.endswith('.yaml'):
            filepath = os.path.join(plugins_path, filename)
            with open(filepath, 'r') as f:
                try:
                    # Load all documents from a single file
                    all_data = yaml.safe_load_all(f)
                    for data in all_data:
                        if data and 'metadata' in data and 'name' in data['metadata']:
                            plugin_names.add(data['metadata']['name'])
                except yaml.YAMLError as e:
                    print(f"Error reading {filepath}: {e}")
                    warnings_found = True

    for filename in os.listdir(packages_path):
        if filename.endswith('.yaml'):
            with open(os.path.join(packages_path, filename), 'r') as f:
                try:
                    data = yaml.safe_load(f)
                    if data and 'spec' in data and 'partOf' in data['spec']:
                        for plugin in data['spec']['partOf']:
                            found = False
                            for p_name in plugin_names:
                                if plugin in p_name:
                                    found = True
                                    break
                            if not found:
                                print(f"Warning: Package {filename}  contains unknown plugin with name '{plugin}'. Find correct plugin name defined in the yaml section \"metadata.name\".\n")
                                warnings_found = True
                except yaml.YAMLError as e:
                    print(f"Error reading {filename}: {e}")
                    warnings_found = True
    return warnings_found

def find_reverse_discrepancies():
    packages_path = './catalog-entities/marketplace/packages'
    plugins_path = './catalog-entities/marketplace/plugins'
    warnings_found = False

    package_names = set()
    for filename in os.listdir(packages_path):
        if filename.endswith('.yaml'):
            filepath = os.path.join(packages_path, filename)
            with open(filepath, 'r') as f:
                try:
                    data = yaml.safe_load(f)
                    if data and 'metadata' in data and 'name' in data['metadata']:
                        package_names.add(data['metadata']['name'])
                except yaml.YAMLError as e:
                    print(f"Error reading {filepath}: {e}")
                    warnings_found = True

    for filename in os.listdir(plugins_path):
        if filename.endswith('.yaml'):
            filepath = os.path.join(plugins_path, filename)
            with open(filepath, 'r') as f:
                try:
                    all_data = yaml.safe_load_all(f)
                    for data in all_data:
                        if data and 'spec' in data and 'packages' in data['spec'] and data['spec']['packages']:
                            for package_item in data['spec']['packages']:
                                package_name = None
                                if isinstance(package_item, str):
                                    package_name = package_item
                                elif isinstance(package_item, dict) and 'name' in package_item:
                                    package_name = package_item['name']

                                if package_name and package_name not in package_names:
                                    print(f"Warning: Plugin {filename} contains unknown package with name '{package_name}'. Find correct package name defined in the yaml section \"metadata.name\".\n")
                                    warnings_found = True
                except yaml.YAMLError as e:
                    print(f"Error reading {filepath}: {e}")
                    warnings_found = True
    return warnings_found


if __name__ == '__main__':
    discrepancies_found = find_discrepancies()
    print("\n--- Reverse Check ---\n")
    reverse_discrepancies_found = find_reverse_discrepancies()

    if discrepancies_found or reverse_discrepancies_found:
        print("Discrepancies found. Exiting with error.")
        sys.exit(1)
    else:
        print("No discrepancies found.")