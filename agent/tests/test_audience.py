"""Audience resolution must read the roster and fail safe — never guess."""

import asyncio

import pytest

from assistant import audience

CLASSES = [
    {"class": "TULIP 1", "students": 40},
    {"class": "2ND LILY", "students": 38},
    {"class": "5-A", "students": 42},
]


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def stub_classes(monkeypatch):
    async def fake_rows():
        return CLASSES

    monkeypatch.setattr(audience, "class_rows", fake_rows)


def test_everyone_words_resolve_to_all():
    for word in ["all", "All", "everyone", "every body", "every student", "whole school", "sab", "sabhi log"]:
        assert run(audience.resolve(word)) == {"scope": "all"}, word


def test_class_matches_ignore_case_spacing_and_punctuation():
    assert run(audience.resolve("tulip 1")) == {"scope": "class", "className": "TULIP 1"}
    assert run(audience.resolve("2nd-lily")) == {"scope": "class", "className": "2ND LILY"}
    assert run(audience.resolve("5 a")) == {"scope": "class", "className": "5-A"}


def test_a_unique_partial_still_resolves():
    assert run(audience.resolve("Tulip")) == {"scope": "class", "className": "TULIP 1"}
    assert run(audience.resolve("lily")) == {"scope": "class", "className": "2ND LILY"}


def test_unknown_class_asks_instead_of_guessing():
    out = run(audience.resolve("Rose"))
    assert "error" in out
    assert "TULIP 1" in out["classes"]  # the real classes, so the reply can list them


def test_empty_target_asks():
    assert "error" in run(audience.resolve(""))


def test_ambiguous_partial_asks(monkeypatch):
    async def fake_rows():
        return [{"class": "LILY A", "students": 1}, {"class": "LILY B", "students": 2}]

    monkeypatch.setattr(audience, "class_rows", fake_rows)
    out = run(audience.resolve("lily"))
    assert "error" in out
    assert len(out["classes"]) == 2


def test_normalise_strips_noise():
    assert audience.normalise("  2ND  Lily! ") == "2ndlily"
    assert audience.normalise("5-A") == "5a"


def test_describe_reads_naturally():
    assert audience.describe({"scope": "all"}) == "everyone"
    assert audience.describe({"scope": "class", "className": "TULIP 1"}) == "TULIP 1"
