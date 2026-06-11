#!/usr/bin/env python3
"""Fetch recent arXiv papers into a static JSON file for GitHub Pages."""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path


ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV = "{http://arxiv.org/schemas/atom}"
DEFAULT_CATEGORIES = [
    "cs.AI",
    "cs.CL",
    "cs.CV",
    "cs.LG",
    "cs.RO",
    "eess.IV",
    "math.OC",
    "physics.med-ph",
    "q-bio.QM",
    "stat.ML",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="papers.json")
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--per-category", type=int, default=25)
    parser.add_argument("--pause", type=float, default=3.2)
    parser.add_argument("--category", action="append", dest="categories")
    args = parser.parse_args()

    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    categories = args.categories or DEFAULT_CATEGORIES
    papers_by_id: dict[str, dict] = {}

    for index, category in enumerate(categories):
        if index:
            time.sleep(args.pause)
        for paper in fetch_category(category, args.per_category, since):
            papers_by_id[paper["id"]] = paper

    papers = sorted(papers_by_id.values(), key=lambda item: item["published"], reverse=True)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "https://export.arxiv.org/api/query",
        "days": args.days,
        "categories": categories,
        "papers": papers,
    }

    Path(args.output).write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(papers)} papers to {args.output}")


def fetch_category(category: str, limit: int, since: datetime) -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "search_query": f"cat:{category}",
            "start": "0",
            "max_results": str(limit),
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
    )
    url = f"https://export.arxiv.org/api/query?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": "paper-axiv/1.0"})

    with urllib.request.urlopen(request, timeout=45) as response:
        xml = response.read()

    root = ET.fromstring(xml)
    papers = [parse_entry(entry) for entry in root.findall(f"{ATOM}entry")]
    return [paper for paper in papers if parse_date(paper["published"]) >= since]


def parse_entry(entry: ET.Element) -> dict:
    paper_id = text(entry, f"{ATOM}id")
    categories = [node.attrib["term"] for node in entry.findall(f"{ATOM}category") if "term" in node.attrib]
    primary = entry.find(f"{ARXIV}primary_category")
    pdf_url = next(
        (
            node.attrib["href"]
            for node in entry.findall(f"{ATOM}link")
            if node.attrib.get("title") == "pdf" and "href" in node.attrib
        ),
        paper_id.replace("/abs/", "/pdf/"),
    )

    return {
        "id": paper_id.rsplit("/", 1)[-1],
        "title": clean(text(entry, f"{ATOM}title")),
        "authors": [clean(text(author, f"{ATOM}name")) for author in entry.findall(f"{ATOM}author")],
        "summary": clean(text(entry, f"{ATOM}summary")),
        "published": text(entry, f"{ATOM}published"),
        "updated": text(entry, f"{ATOM}updated"),
        "categories": categories,
        "primaryCategory": primary.attrib.get("term", categories[0] if categories else "") if primary is not None else "",
        "abstractUrl": paper_id,
        "pdfUrl": pdf_url,
    }


def text(node: ET.Element, selector: str) -> str:
    child = node.find(selector)
    return (child.text or "").strip() if child is not None else ""


def clean(value: str) -> str:
    return " ".join(value.split())


def parse_date(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


if __name__ == "__main__":
    main()
