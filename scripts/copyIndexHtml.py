import re
import os

# Copies the app markup of client/index.html into the gh-pages index.html.
# The copied block goes from the <body ...> tag (included) to the last <script>
# of the body (excluded), so the gh-pages <head> and its configuration
# <script> (SERVER_ADDRESS, bundle path...) are kept as they are.

def get_body_block(html_content):
    """
    Returns: (start_index, end_index, extracted_html_string)
    """
    start_match = re.search(r'<body[^>]*>', html_content, re.IGNORECASE)
    if not start_match:
        return None, None, None

    body_end = html_content.lower().rfind('</body>')
    if body_end == -1:
        return None, None, None

    end_idx = html_content.lower().rfind('<script', start_match.end(), body_end)
    if end_idx == -1:
        return None, None, None

    start_idx = start_match.start()
    return start_idx, end_idx, html_content[start_idx:end_idx]

def copy_body(source_file, dest_file):
    if not os.path.exists(source_file) or not os.path.exists(dest_file):
        print("Error: Source or destination file not found.")
        return

    with open(source_file, 'r', encoding='utf-8') as f:
        source_html = f.read()

    with open(dest_file, 'r', encoding='utf-8') as f:
        dest_html = f.read()

    _, _, source_block = get_body_block(source_html)
    if not source_block:
        print(f"Error: Could not find <body> ... <script> in {source_file}")
        return

    dest_start, dest_end, _ = get_body_block(dest_html)
    if dest_start is None:
        print(f"Error: Could not find <body> ... <script> in {dest_file}")
        return

    updated_dest_html = dest_html[:dest_start] + source_block + dest_html[dest_end:]

    with open(dest_file, 'w', encoding='utf-8') as f:
        f.write(updated_dest_html)

    print("Successfully copied <body> while preserving the gh-pages <head> and <script>!")

if __name__ == "__main__":
    SOURCE = "client/dist/index.html"
    DEST = "index.html"

    copy_body(SOURCE, DEST)
