"""
Script to remove support: and lifecycle: keywords from package.json files.

This script removes keywords starting with "support:" and "lifecycle:" from all
package.json files in dynamic-plugins/wrappers/, making YAML files the single 
source of truth for this metadata.

Co-author: cursor
"""

import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple


class KeywordRemover:
    def __init__(self, repo_root: str):
        self.repo_root = Path(repo_root)
        self.dynamic_plugins_dir = self.repo_root / "dynamic-plugins" / "wrappers"
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
    
    def remove_keywords_from_file(self, package_path: Path) -> Dict:
        """Remove support: and lifecycle: keywords from a package.json file"""
        result = {
            'package': package_path.parent.name,
            'path': str(package_path),
            'modified': False,
            'removed_keywords': [],
            'remaining_keywords': [],
            'error': None
        }
        
        try:
            # Read the current package.json
            with open(package_path, 'r') as f:
                content = f.read()
                data = json.loads(content)
            
            # Check if keywords exist
            if 'keywords' not in data:
                result['message'] = "No keywords array found"
                return result
            
            original_keywords = data['keywords'].copy()
            
            # Filter out support: and lifecycle: keywords
            filtered_keywords = []
            removed_keywords = []
            
            for keyword in original_keywords:
                if keyword.startswith('support:') or keyword.startswith('lifecycle:'):
                    removed_keywords.append(keyword)
                else:
                    filtered_keywords.append(keyword)
            
            # Update the result tracking
            result['removed_keywords'] = removed_keywords
            result['remaining_keywords'] = filtered_keywords
            
            if removed_keywords:
                result['modified'] = True
                
                # Update the data
                if filtered_keywords:
                    # Keep keywords array with remaining keywords
                    data['keywords'] = filtered_keywords
                else:
                    # Remove empty keywords array
                    del data['keywords']
                
                # Write back to file with proper formatting
                with open(package_path, 'w') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                    f.write('\n')  # Add trailing newline
                
                result['message'] = f"Removed {len(removed_keywords)} keywords"
            else:
                result['message'] = "No support/lifecycle keywords found"
                
        except Exception as e:
            result['error'] = str(e)
            result['message'] = f"Error processing file: {e}"
        
        return result
    
    def process_all_files(self) -> None:
        """Process all package.json files and remove keywords"""
        package_files = self.find_package_json_files()
        
        print(f"Found {len(package_files)} package.json files to process\n")
        
        for package_path in package_files:
            result = self.remove_keywords_from_file(package_path)
            self.results.append(result)
            
            # Print progress
            status = "✅" if result['modified'] else "ℹ️" if not result['error'] else "❌"
            print(f"{status} {result['package']}: {result['message']}")
            
            if result['removed_keywords']:
                print(f"   Removed: {result['removed_keywords']}")
            if result['remaining_keywords']:
                print(f"   Remaining: {result['remaining_keywords']}")
            if result['error']:
                print(f"   Error: {result['error']}")
    
    def print_summary(self) -> None:
        """Print a summary of the operations"""
        total_files = len(self.results)
        modified_count = len([r for r in self.results if r['modified']])
        error_count = len([r for r in self.results if r['error']])
        total_keywords_removed = sum(len(r['removed_keywords']) for r in self.results)
        
        print("\n" + "=" * 80)
        print("KEYWORD REMOVAL SUMMARY")
        print("=" * 80)
        
        print(f"\n📁 Total files processed: {total_files}")
        print(f"✅ Files modified: {modified_count}")
        print(f"❌ Files with errors: {error_count}")
        print(f"🗑️  Total keywords removed: {total_keywords_removed}")
        
        if modified_count > 0:
            print(f"\n{'='*50}")
            print("MODIFIED FILES:")
            print(f"{'='*50}")
            
            for result in self.results:
                if result['modified']:
                    print(f"📦 {result['package']}")
                    print(f"   Removed: {result['removed_keywords']}")
                    if result['remaining_keywords']:
                        print(f"   Remaining: {result['remaining_keywords']}")
                    else:
                        print(f"   Keywords array removed (was empty)")
        
        if error_count > 0:
            print(f"\n{'='*50}")
            print("FILES WITH ERRORS:")
            print(f"{'='*50}")
            
            for result in self.results:
                if result['error']:
                    print(f"❌ {result['package']}: {result['error']}")
        
        print(f"\n💡 Note: YAML files in catalog-entities/marketplace/packages/ are now")
        print(f"   the single source of truth for support and lifecycle metadata.")


def main():
    """Main function"""
    # Get the repository root (assuming script is in scripts/ directory)
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent
    
    if not (repo_root / "dynamic-plugins").exists():
        print("Error: Could not find dynamic-plugins directory. Make sure you're running from the correct location.")
        sys.exit(1)
    
    # Ask for confirmation
    print("⚠️  WARNING: This script will remove 'support:*' and 'lifecycle:*' keywords")
    print("   from ALL package.json files in dynamic-plugins/wrappers/")
    print("\n   This will make YAML files the single source of truth for this metadata.")
    print("\n   Continue? (y/N): ", end="")
    
    confirmation = input().strip().lower()
    if confirmation != 'y' and confirmation != 'yes':
        print("Operation cancelled.")
        sys.exit(0)
    
    remover = KeywordRemover(str(repo_root))
    remover.process_all_files()
    remover.print_summary()
    
    if any(r['error'] for r in remover.results):
        sys.exit(1)


if __name__ == "__main__":
    main()
