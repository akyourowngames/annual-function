"""Hearing must arrive with the browser's own audio, and fail without a key."""

import asyncio

import pytest

from assistant import stt


def run(coro):
    return asyncio.run(coro)


def test_the_file_name_follows_the_mime_type():
    # Groq sniffs the container, so the extension has to match what the browser
    # actually recorded. Chrome, Firefox and Safari each pick a different one.
    assert stt._filename("audio/webm;codecs=opus") == "clip.webm"
    assert stt._filename("audio/webm") == "clip.webm"
    assert stt._filename("audio/ogg;codecs=opus") == "clip.ogg"
    assert stt._filename("audio/mp4") == "clip.mp4"
    assert stt._filename("AUDIO/MP4") == "clip.mp4"


def test_an_unknown_type_still_gets_a_name():
    assert stt._filename("") == "clip.webm"
    assert stt._filename("application/octet-stream") == "clip.webm"


def test_without_a_key_it_says_so_rather_than_guessing(monkeypatch):
    monkeypatch.setattr(stt, "GROQ_API_KEY", "")
    assert stt.ready() is False
    with pytest.raises(stt.SttUnavailable):
        run(stt.transcribe(b"not really audio", "audio/webm"))


def test_an_empty_clip_is_never_sent(monkeypatch):
    monkeypatch.setattr(stt, "GROQ_API_KEY", "test-key")
    assert run(stt.transcribe(b"", "audio/webm")) == ""


def test_an_oversized_clip_is_refused_before_upload(monkeypatch):
    monkeypatch.setattr(stt, "GROQ_API_KEY", "test-key")
    monkeypatch.setattr(stt, "MAX_BYTES", 4)
    with pytest.raises(stt.SttUnavailable):
        run(stt.transcribe(b"12345", "audio/webm"))
