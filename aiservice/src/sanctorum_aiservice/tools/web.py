"""The `fetch_url` tool — read a web page as text.

WHY THIS EXISTS. `search` returns five titles, links and ~200-character
snippets. Without a way to OPEN one of those links, an agent can discover that a
page exists but never read it — search is half a tool on its own. This is the
other half: one GET, the markup stripped, the readable text returned.

It is deliberately NOT a browser. No JavaScript, no clicking, no logging in, no
forms. That covers documentation, articles, API references and READMEs — most of
what "the agent researched something" actually means — at roughly a
ten-thousandth the cost of driving a real browser with a vision model.

THE SSRF GUARD IS THE WHOLE SECURITY STORY OF THIS FILE.

An agent that can fetch an arbitrary URL can, without one, fetch
`http://localhost:3001/api/agents` — the app's OWN backend — and read the org it
is a member of. Or a cloud metadata endpoint at 169.254.169.254. The address
does not have to look local: a hostname can resolve to 127.0.0.1, and a public
URL can REDIRECT to one. So every hop is resolved and checked, not just the
first, and the check is on the resolved IP rather than the text of the host.

This tool only reads, so it sits low on the ladder (clearance 1) and inside
READ_ONLY_TOOLS: a read-only workspace mount is a promise about the user's
files, not a vow of silence towards the internet.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

# Keeps a page from swallowing the model's whole context. ~40k characters is
# comfortably more than any article and still small beside a context window.
_MAX_CHARS = 40_000

# A hard cap on what we will pull over the wire, so a linked ISO or video cannot
# be dragged into memory before we notice it is not a document.
_MAX_BYTES = 5 * 1024 * 1024

_TIMEOUT = 20.0

# One hop is a redirect to the canonical URL; several is usually a tracker.
_MAX_REDIRECTS = 5

# AN HONEST USER-AGENT, NOT A BROWSER DISGUISE.
#
# This first shipped claiming to be Chrome, on the theory that an unknown agent
# gets 403'd more often. That theory cost us Wikipedia — and every other
# Wikimedia property — outright:
#
#   fetch_url("https://en.wikipedia.org/wiki/Wikipedia")  ->  HTTP 403
#
# Wikimedia's User-Agent policy explicitly blocks clients that impersonate a
# browser without being one, and asks for a real name plus a contact URL. So the
# disguise failed on one of the highest-value sites an agent will ever read,
# while the honest string returns 200.
#
# Measured, not assumed: the honest UA gets 200 from Wikipedia, example.com,
# Hacker News, docs.python.org and GitHub. Stack Overflow 403s BOTH strings —
# that is Cloudflare fingerprinting, which no User-Agent fixes — so there is
# nothing the browser disguise buys and a great deal it costs.
_UA = "Sanctorum/1.0 (+https://github.com/ablancq95/sanctorum; agent fetch tool) httpx"

# Content we can turn into text. Anything else (a PDF, an image, a zip) is
# reported rather than decoded into mojibake.
_TEXTUAL = ("text/", "application/json", "application/xml", "application/xhtml")


class Blocked(Exception):
    """A URL was refused before any request was made."""


def _check_host(host: str) -> None:
    """Resolve `host` and refuse any address that points back inside.

    Every address the name resolves to is checked, not just the first: a host
    with both a public and a private A record would otherwise pass on one
    lookup and connect on the other.
    """
    if not host:
        raise Blocked("no host in that URL")

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise Blocked(f"'{host}' could not be resolved ({exc})") from exc

    for info in infos:
        raw = info[4][0]
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            continue
        # `is_global` is the one check that matters, and it is the reason this
        # is an allowlist rather than a denylist of ranges to remember: it
        # excludes loopback, link-local (169.254.x — cloud metadata), private
        # ranges, multicast, reserved and unspecified in a single test that the
        # stdlib keeps correct for both IPv4 and IPv6.
        if not ip.is_global:
            raise Blocked(
                f"'{host}' resolves to {ip}, which is not a public address. "
                "Fetching private, loopback or link-local addresses is refused."
            )


def _check_url(url: str) -> str:
    """Validate a URL's scheme and host, returning it normalised."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise Blocked(
            f"'{parsed.scheme or url}' is not a web address. Only http and https are allowed."
        )
    _check_host(parsed.hostname or "")
    return parsed.geturl()


# Wikimedia sites an agent is likely to be pointed at. Matched on the REGISTERED
# DOMAIN so every language subdomain (en., de., simple., en.m.) is covered by one
# entry rather than a list that is always missing one.
_WIKIMEDIA_DOMAINS = (
    "wikipedia.org",
    "wiktionary.org",
    "wikiquote.org",
    "wikibooks.org",
    "wikisource.org",
    "wikinews.org",
    "wikiversity.org",
    "wikivoyage.org",
    "wikidata.org",
)


def _rest_url(url: str) -> str | None:
    """Rewrite a Wikimedia ARTICLE url to its REST API equivalent, or None.

    WHY SPECIAL-CASE ONE FAMILY OF SITES. An article page is ~2.2 MB of skin:
    navigation, sidebars, edit links, citation machinery, the full language list.
    trafilatura can extract from it, but the REST endpoint returns the SAME
    article as clean, structured HTML built for reuse — no skin to discard, no
    heuristic to be wrong about. These are also among the most-fetched pages on
    the web, so the named path earns its lines.

    Returns None for anything that is not a plain article (a Talk: page, a
    Special: page, a search URL), which falls through to the ordinary path.
    """
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if not any(host == d or host.endswith("." + d) for d in _WIKIMEDIA_DOMAINS):
        return None

    prefix = "/wiki/"
    if not parsed.path.startswith(prefix):
        return None

    title = parsed.path[len(prefix) :]
    # Namespaced pages (Talk:, Special:, Wikipedia:, File:) are not articles and
    # the REST article endpoint does not serve them. `%3A` is the same colon
    # url-encoded, which is how a search result often spells it.
    if not title or ":" in title or "%3A" in title.upper():
        return None

    return f"{parsed.scheme}://{host}/api/rest_v1/page/html/{title}"


def _to_text(html: str) -> str:
    """Strip markup, preferring a real readability pass.

    trafilatura pulls the ARTICLE out — dropping nav, footers, cookie banners
    and sidebars — which is the difference between a page the model can reason
    about and eight thousand characters of menu. When it is unavailable or finds
    nothing, fall back to a plain tag strip rather than failing the call.
    """
    try:
        import trafilatura  # noqa: PLC0415 — optional, imported at use

        extracted = trafilatura.extract(
            html,
            include_links=False,
            include_images=False,
            include_comments=False,
            favor_recall=True,
        )
        if extracted and extracted.strip():
            return extracted.strip()
    except Exception:  # noqa: BLE001 — never fail the fetch over the extractor
        pass

    # Fallback: drop script/style bodies, then every remaining tag.
    import re  # noqa: PLC0415

    cleaned = re.sub(
        r"<(script|style|noscript)\b[^>]*>.*?</\1>", " ", html, flags=re.S | re.I
    )
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    # Unescape the handful of entities that survive a naive strip.
    import html as _html  # noqa: PLC0415

    cleaned = _html.unescape(cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


# Prefixed to EVERY failure. The words matter more than they look.
#
# A 403 used to come back as a bare "error: ... returned HTTP 403", which is just
# a string the model reads and routes around. Asked to summarise a Wikipedia
# article it could not fetch, an agent fell back to `search` snippets, a Facebook
# post and a DBpedia dump, wrote a confident summary, and the evaluator PASSED it
# — the user had no way to know the source was never read.
#
# That is the failure this product cannot have. Supervision means the human sees
# what happened, and "I could not read the source" disappearing into fluent prose
# is the opposite. So a failed fetch now carries an explicit instruction to say
# so in the final answer, rather than leaving it to the model's judgement.
_MUST_DISCLOSE = (
    "IMPORTANT: this page could not be read. If you answer from web search "
    "snippets, your own knowledge, or any other source instead, you MUST say so "
    "plainly in your final answer — state that you could not access "
    "{url} and name what you used instead. Do not present a summary as though "
    "you had read the page."
)


def _failed(url: str, detail: str) -> str:
    """A failure the model is told, in words, not to paper over."""
    return "error: " + detail + "\n\n" + _MUST_DISCLOSE.format(url=url)


def _get(target: str) -> str | None:
    """Fetch one URL and return its readable text, or None if it did not work.

    Shared by the REST attempt and the ordinary path so there is ONE place that
    knows how to follow a redirect safely, decode a body and extract text.
    Returns None rather than an error string, because the caller decides whether
    a miss is fatal (the ordinary path) or just means "try the normal URL"
    (the REST attempt).
    """
    try:
        # Redirects are followed BY HAND so each hop can be re-checked. With
        # follow_redirects=True, httpx would happily walk from a public URL to
        # http://localhost and the SSRF guard would never see it.
        with httpx.Client(
            timeout=_TIMEOUT,
            follow_redirects=False,
            headers={"User-Agent": _UA, "Accept": "text/html,application/xhtml+xml,*/*"},
        ) as client:
            hops = 0
            while True:
                resp = client.get(target)
                if resp.is_redirect and hops < _MAX_REDIRECTS:
                    location = resp.headers.get("location", "")
                    if not location:
                        break
                    target = str(resp.url.join(location))
                    # Re-validated like any other address: this is the hop a
                    # naive follow_redirects would use to reach localhost.
                    _check_url(target)
                    hops += 1
                    continue
                break
    except Blocked:
        raise
    except httpx.HTTPError:
        return None

    if resp.status_code >= 400:
        return None

    content_type = (resp.headers.get("content-type") or "").lower()
    if content_type and not any(content_type.startswith(t) for t in _TEXTUAL):
        return None

    raw = resp.content[:_MAX_BYTES]
    try:
        html = raw.decode(resp.encoding or "utf-8", errors="replace")
    except (LookupError, UnicodeDecodeError):
        html = raw.decode("utf-8", errors="replace")

    is_html = "html" in content_type or "<html" in html[:2000].lower()
    text = _to_text(html) if is_html else html.strip()
    if not text:
        return None

    if len(text) > _MAX_CHARS:
        # Say it was cut. A model that does not know it read a fragment will
        # answer as though it read the whole page.
        text = text[:_MAX_CHARS] + f"\n\n[truncated at {_MAX_CHARS} characters]"
    return text


def fetch_url(url: str) -> str:
    """Fetch `url` and return its readable text."""
    if not (url or "").strip():
        return "error: a url is required."

    try:
        target = _check_url(url)
    except Blocked as exc:
        # A refusal is NOT a loud failure: the agent asked for something it may
        # not have, and the guard worked. Nothing to disclose to the user.
        return f"refused: {exc}"

    # A Wikimedia article is served better by its REST endpoint (see _rest_url).
    # If that misses — a redirect, a title needing normalisation — the ordinary
    # article URL is still tried below, so the rewrite can never LOSE a page.
    try:
        rest = _rest_url(target)
        if rest:
            via_rest = _get(rest)
            if via_rest is not None:
                return f"{target}\n\n{via_rest}"

        text = _get(target)
    except Blocked as exc:
        return f"refused: redirected to a blocked address — {exc}"

    if text is None:
        # Everything that went wrong lands here, and every one of them tells the
        # model to disclose the gap rather than quietly answering anyway.
        return _failed(
            target,
            f"{target} could not be read. The site may have refused the request "
            f"(403), returned an error, served a non-text file, or rendered its "
            f"content entirely in JavaScript.",
        )

    return f"{target}\n\n{text}"
