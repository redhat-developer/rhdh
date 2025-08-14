import json
import yaml
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple


class PackageYamlChecker:
    def __init__(self, repo_root: str):
        self.repo_root = Path(repo_root)
        self.dynamic_plugins_dir = self.repo_root / "dynamic-plugins" / "wrappers"
        self.marketplace_dir = self.repo_root / "catalog-entities" / "marketplace" / "packages"
        self.results = []
        
    def find_package_json_files(self) -> List[Path]:
        """Find all package.json files in dynamic-plugins/wrappers/"""
        package_files = []
        for item in self.dynamic_plugins_dir.iterdir():
            if item.is_dir():
                package_json = item / "package.json"
                if package_json.exists():
                    package_files.append(package_json)
        return package_files
    
    def extract_keywords_from_package_json(self, package_path: Path) -> Dict[str, str]:
        """Extract support and lifecycle keywords from package.json"""
        try:
            with open(package_path, 'r') as f:
                data = json.load(f)
            
            keywords = data.get('keywords', [])
            result = {}
            
            for keyword in keywords:
                if keyword.startswith('support:'):
                    result['support'] = keyword.replace('support:', '')
                elif keyword.startswith('lifecycle:'):
                    result['lifecycle'] = keyword.replace('lifecycle:', '')
            
            return result
        except Exception as e:
            print(f"Error reading {package_path}: {e}")
            return {}
    
    def find_corresponding_yaml(self, package_name: str) -> Optional[Path]:
        """
            Find the corresponding YAML file for a package
            Assisted-by: Cursor
        """
        # First try exact match
        yaml_file = self.marketplace_dir / f"{package_name}.yaml"
        if yaml_file.exists():
            return yaml_file
        
        # If package name ends with -dynamic, try without the suffix
        # This handles backend plugins where directory is name-dynamic but YAML is just name
        if package_name.endswith('-dynamic'):
            yaml_name_without_dynamic = package_name[:-8]  # Remove '-dynamic'
            yaml_file = self.marketplace_dir / f"{yaml_name_without_dynamic}.yaml"
            if yaml_file.exists():
                return yaml_file
        
        # fuzzy: try prefix/suffix relations and common aliasing
        # Assisted-by: Cursor - since the naming convention is not consistent
        alias_name = package_name.replace('red-hat-developer-hub', 'rhdh')
        for p in self.marketplace_dir.glob('*.yaml'):
            stem = p.stem
            if (
                stem.endswith(package_name)
                or package_name.endswith(stem)
                or stem.startswith(package_name)
                or package_name.startswith(stem)
                or stem == alias_name
                or stem.startswith(alias_name)
                or alias_name.startswith(stem)
            ):
                return p

        return None
    
    def extract_spec_from_yaml(self, yaml_path: Path) -> Dict[str, str]:
        """Extract support and lifecycle from YAML spec"""
        try:
            with open(yaml_path, 'r') as f:
                data = yaml.safe_load(f)
            
            spec = data.get('spec', {})
            result = {}
            
            if 'support' in spec:
                result['support'] = spec['support']
            if 'lifecycle' in spec:
                result['lifecycle'] = spec['lifecycle']
            
            return result
        except Exception as e:
            print(f"Error reading {yaml_path}: {e}")
            return {}
    
    def get_package_name_from_path(self, package_path: Path) -> str:
        """Extract package name from the directory path"""
        return package_path.parent.name
    
    def check_consistency(self, verbose: bool = False) -> None:
        """Main method to check consistency between all package.json and YAML files"""
        package_files = self.find_package_json_files()
        
        if verbose:
            print(f"Found {len(package_files)} package.json files to check\n")
        
        for package_path in package_files:
            package_name = self.get_package_name_from_path(package_path)
            
            # Extract keywords from package.json
            json_keywords = self.extract_keywords_from_package_json(package_path)
            
            # Find and read corresponding YAML
            yaml_path = self.find_corresponding_yaml(package_name)
            
            if not yaml_path:
                self.results.append({
                    'package': package_name,
                    'status': 'NO_YAML',
                    'message': f"No corresponding YAML file found for {package_name}",
                    'json_path': str(package_path),
                    'yaml_path': None
                })
                continue
            
            # Track if we used the -dynamic mapping
            used_dynamic_mapping = package_name.endswith('-dynamic') and not (self.marketplace_dir / f"{package_name}.yaml").exists()
            
            yaml_spec = self.extract_spec_from_yaml(yaml_path)
            
            # Compare the values
            issues = []
            
            # Check support
            json_support = json_keywords.get('support')
            yaml_support = yaml_spec.get('support')
            
            if json_support != yaml_support:
                issues.append(f"Support mismatch: JSON='{json_support}' vs YAML='{yaml_support}'")
            
            # Check lifecycle
            json_lifecycle = json_keywords.get('lifecycle')
            yaml_lifecycle = yaml_spec.get('lifecycle')
            
            if json_lifecycle != yaml_lifecycle:
                issues.append(f"Lifecycle mismatch: JSON='{json_lifecycle}' vs YAML='{yaml_lifecycle}'")
            
            # Check for missing fields
            if json_support is None and yaml_support is not None:
                issues.append(f"Support missing in JSON but present in YAML: '{yaml_support}'")
            if json_lifecycle is None and yaml_lifecycle is not None:
                issues.append(f"Lifecycle missing in JSON but present in YAML: '{yaml_lifecycle}'")
            if json_support is not None and yaml_support is None:
                issues.append(f"Support present in JSON but missing in YAML: '{json_support}'")
            if json_lifecycle is not None and yaml_lifecycle is None:
                issues.append(f"Lifecycle present in JSON but missing in YAML: '{json_lifecycle}'")
            
            self.results.append({
                'package': package_name,
                'status': 'MISMATCH' if issues else 'OK',
                'issues': issues,
                'json_keywords': json_keywords,
                'yaml_spec': yaml_spec,
                'json_path': str(package_path),
                'yaml_path': str(yaml_path),
                'used_dynamic_mapping': used_dynamic_mapping
            })
    
    def print_report(self, verbose: bool = False) -> None:
        """
        Print a detailed report of the findings
        Assisted-by: Cursor
        """
        if verbose:
            print("=" * 80)
            print("PACKAGE.JSON vs marketplace catalog entity CONSISTENCY CHECK REPORT")
            print("=" * 80)
        
        ok_count = 0
        mismatch_count = 0
        no_yaml_count = 0
        backend_plugin_count = 0
        frontend_plugin_count = 0
        backends_without_dynamic: List[str] = []
        
        for result in self.results:
            status = result['status']
            package_name = result['package']
            
            # Count plugin types based on naming patterns
            is_backend = ('-backend' in package_name) or package_name.endswith('-dynamic')
            if is_backend:
                backend_plugin_count += 1
                if not package_name.endswith('-dynamic'):
                    backends_without_dynamic.append(package_name)
            else:
                frontend_plugin_count += 1
            
            if status == 'OK':
                ok_count += 1
            elif status == 'MISMATCH':
                mismatch_count += 1
            elif status == 'NO_YAML':
                no_yaml_count += 1
        
        print(f"\nSUMMARY:")
        print(f"✅ Consistent packages: {ok_count}")
        print(f"❌ Inconsistent packages: {mismatch_count}")
        print(f"⚠️ Missing marketplace catalog entity files: {no_yaml_count}")
        print(f"📁 Total packages checked: {len(self.results)}")
        print(f"🔧 Backend/module plugins: {backend_plugin_count}")
        print(f"🎨 Frontend plugins: {frontend_plugin_count}")
        if verbose and backends_without_dynamic:
            print(f"\n💡 Note: {len(backends_without_dynamic)} backend plugins without -dynamic suffix:")
            for p in sorted(backends_without_dynamic):
                print(f"   - {p}")
        
        if mismatch_count > 0:
            if verbose:
                print(f"\n{'='*50}")
                print("INCONSISTENT PACKAGES:")
                print(f"{'='*50}")
            
            for result in self.results:
                if result['status'] == 'MISMATCH':
                    print(f"\n📦 {result['package']}")
                    if verbose:
                        print(f"   JSON: {result['json_path']}")
                        print(f"   YAML: {result['yaml_path']}")
                    for issue in result['issues']:
                        print(f"   ❌ {issue}")
        
        if no_yaml_count > 0:
            if verbose:
                print(f"\n{'='*50}")
                print("MISSING marketplace catalog entity FILES:")
                print(f"{'='*50}")
            
            for result in self.results:
                if result['status'] == 'NO_YAML':
                    print(f"⚠️  {result['package']}")
        
        if verbose and ok_count > 0:
            print(f"\n{'='*50}")
            print("CONSISTENT PACKAGES:")
            print(f"{'='*50}")
            
            for result in self.results:
                if result['status'] == 'OK':
                    print(f"✅ {result['package']}")


def main():
    """Main function"""
    # Get the repository root (assuming script is in scripts/ directory)
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent
    
    if not (repo_root / "dynamic-plugins").exists():
        print("Error: Could not find dynamic-plugins directory. Make sure you're running from the correct location.")
        sys.exit(1)
    
    parser = None
    # add a lightweight flag without changing external callers
    verbose = '--verbose' in sys.argv
    checker = PackageYamlChecker(str(repo_root))
    checker.check_consistency(verbose=verbose)
    checker.print_report(verbose=verbose)
    
    # Exit with error code if there are mismatches
    mismatches = [r for r in checker.results if r['status'] == 'MISMATCH']
    if mismatches:
        sys.exit(1)


if __name__ == "__main__":
    main()
