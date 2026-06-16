"""
Range-aware media serving for development.

Django's built-in ``static.serve`` (used by ``django.conf.urls.static.static``)
returns the whole file with a ``200`` for ``Range:`` requests instead of a
``206 Partial Content``. Browsers tolerate that for images, but ``<video>``
scrubbing relies on byte-range requests to fetch just the bytes around the seek
target — without them, seeking a large clip stalls while the whole file
downloads. This drop-in replacement honours single-range requests so the
frame-accurate video annotator seeks responsively in dev.

Production should serve media via nginx / a CDN, which already do this; this
view is only wired up when ``DEBUG`` is on (see nexus8/urls.py).
"""

import mimetypes
import os
import re

from django.http import (
    FileResponse,
    Http404,
    HttpResponse,
    HttpResponseNotModified,
    StreamingHttpResponse,
)
from django.utils._os import safe_join
from django.utils.http import http_date
from django.views.static import was_modified_since

# A single byte range: "bytes=start-end", either bound optional.
_RANGE_RE = re.compile(r"bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$", re.IGNORECASE)
_CHUNK_SIZE = 64 * 1024


def _bounded_file_iterator(path, start, length, chunk_size=_CHUNK_SIZE):
    """Yield ``length`` bytes from ``path`` starting at ``start``, chunk by chunk."""
    with open(path, "rb") as handle:
        handle.seek(start)
        remaining = length
        while remaining > 0:
            data = handle.read(min(chunk_size, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


def serve_media_with_range(request, path, document_root=None):
    """Serve a file from ``document_root`` with HTTP Range support."""
    full_path = safe_join(document_root, path)
    if not os.path.exists(full_path):
        raise Http404(f'"{path}" does not exist')
    if os.path.isdir(full_path):
        raise Http404("Directory indexes are not allowed here.")

    stat = os.stat(full_path)
    # Honour conditional requests like the stock serve view does.
    if not was_modified_since(request.META.get("HTTP_IF_MODIFIED_SINCE"), stat.st_mtime):
        return HttpResponseNotModified()

    content_type = mimetypes.guess_type(full_path)[0] or "application/octet-stream"
    file_size = stat.st_size
    last_modified = http_date(stat.st_mtime)

    range_header = (request.META.get("HTTP_RANGE") or "").strip()
    match = _RANGE_RE.match(range_header) if range_header else None

    if match:
        start_text, end_text = match.groups()
        if start_text == "":
            # Suffix range: the final N bytes.
            suffix = int(end_text or 0)
            start = max(0, file_size - suffix) if suffix else file_size
            end = file_size - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
        end = min(end, file_size - 1)

        if start > end or start >= file_size:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{file_size}"
            response["Accept-Ranges"] = "bytes"
            return response

        length = end - start + 1
        response = StreamingHttpResponse(
            _bounded_file_iterator(full_path, start, length),
            status=206,
            content_type=content_type,
        )
        response["Content-Length"] = str(length)
        response["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        response["Accept-Ranges"] = "bytes"
        response["Last-Modified"] = last_modified
        return response

    # No range requested: full response, but advertise range support so the
    # browser issues range requests on subsequent seeks.
    response = FileResponse(open(full_path, "rb"), content_type=content_type)
    response["Content-Length"] = str(file_size)
    response["Accept-Ranges"] = "bytes"
    response["Last-Modified"] = last_modified
    return response
