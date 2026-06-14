from html.parser import HTMLParser

class MyHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, self.getpos()))

    def handle_endtag(self, tag):
        if not self.tags:
            self.errors.append(f"Unexpected closing tag </{tag}> at line {self.getpos()[0]}")
            return
        
        last_tag, pos = self.tags.pop()
        if last_tag != tag:
            self.errors.append(f"Mismatched tags: <{last_tag}> opened at line {pos[0]} closed by </{tag}> at line {self.getpos()[0]}")

with open('/Users/duyhuynh/Desktop/AI dashboard/index.html', 'r', encoding='utf-8') as f:
    html_content = f.read()

parser = MyHTMLParser()
parser.feed(html_content)

if parser.errors:
    print("ERRORS FOUND:")
    for err in parser.errors:
        print(err)
else:
    print("SUCCESS: HTML tags are perfectly matched and nested!")
