"""Builds every public page of harmonylivinghouse.com.  Usage: python3 _build/build.py"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
from pages_a import PAGES_A
from pages_b import PAGES_B
import re

def clean_links(html):
    # about.html -> about, index.html -> /  (GitHub Pages serves /about from about.html)
    def rep(m):
        name, anchor = m.group(1), m.group(2) or ''
        return f'href="{"/" if name == "index" else name}{anchor}"'
    return re.sub(r'href="([a-z0-9-]+)\.html(#[^"]*)?"', rep, html)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for slug, title, desc, content, hp in PAGES_A + PAGES_B:
    with open(os.path.join(ROOT, slug), 'w', encoding='utf-8') as f:
        f.write(clean_links(layout(slug, title, desc, content, hp)))
    print('built', slug)
