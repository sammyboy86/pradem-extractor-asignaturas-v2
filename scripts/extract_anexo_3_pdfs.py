import os
import re
import shutil
from pathlib import Path

def extract_anexo_3_pdfs(src_dir="SEDES", dest_dir="anexo3PaqueteAdicional"):
    src_path = Path(src_dir)
    dest_path = Path(dest_dir)
    
    # Create the destination directory if it doesn't exist
    dest_path.mkdir(parents=True, exist_ok=True)
    
    # Regex to find 'anexo' (case insensitive) followed by any non-digit characters, 
    # capturing the first integer that appears.
    pattern = re.compile(r'anexo\D*(\d+)', re.IGNORECASE)
    
    copied_count = 0
    
    for root, dirs, files in os.walk(src_path):
        # We only care about files within a 'LICENCIATURA' directory (or subdirectory)
        parts = Path(root).parts
        if "LICENCIATURA" in parts:
            for file in files:
                if file.lower().endswith('.pdf'):
                    match = pattern.search(file)
                    if match:
                        # Extract the first integer found after 'anexo'
                        found_number = int(match.group(1))
                        if found_number == 3:
                            source_file = Path(root) / file
                            target_file = dest_path / file
                            
                            # Handle duplicate filenames to avoid overwriting
                            counter = 1
                            while target_file.exists():
                                target_file = dest_path / f"{source_file.stem}_{counter}{source_file.suffix}"
                                counter += 1
                                
                            shutil.copy2(source_file, target_file)
                            print(f"Copied: {source_file} -> {target_file}")
                            copied_count += 1

    print(f"\nTotal files copied: {copied_count}")

if __name__ == "__main__":
    extract_anexo_3_pdfs()
