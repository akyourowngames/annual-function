"""Unit tests for the fast path: routing, fallback templates and identity."""

from assistant import identity, router


def test_routing_picks_the_right_tool():
    assert router._route("Give me the brief.")[0] == "briefing"
    assert router._route("what needs my attention?")[0] == "what_needs_attention"
    assert router._route("who hasn't replied?")[0] == "rsvp_report"
    assert router._route("how many can we reach on whatsapp")[0] == "reachability"
    assert router._route("how many arrived")[0] == "checkin_status"
    assert router._route("any photos waiting")[0] == "album_status"
    assert router._route("open support requests")[0] == "open_tickets"
    assert router._route("class breakdown")[0] == "class_breakdown"


def test_family_lookup_preserves_case():
    tool, args = router._route("find Ayaansh Rai")
    assert tool == "find_family"
    assert args["query"] == "Ayaansh Rai"


def test_guest_list_capture():
    tool, args = router._route("guests of ANL-ABC123")
    assert tool == "list_guests"
    assert args["code"].startswith("ANL-")


def test_drafting_and_actions_are_sent_to_the_model():
    # A draft is not a lookup — the model must write it.
    assert router._NEEDS_MODEL.search("draft an announcement about gates opening")
    # And an action that happens to be routable still goes to the model, so the
    # confirmation flow runs instead of a read-only fast answer.
    message = "publish the gallery"
    assert router._route(message)[0] == "album_status"
    assert router._NEEDS_MODEL.search(message)


def test_unroutable_questions_fall_through():
    assert router._route("why did we choose this theme?") is None


def test_templates_are_grammatical_and_hide_zeros():
    rsvp = {"total": 467, "attending": 1, "declined": 0, "awaiting_reply": 466, "expected_guests": 2}
    text = router._template("rsvp_report", rsvp, "who replied")
    assert "1 family has said yes" in text
    assert "2 guests" in text

    album = {"approved": 1, "pending": 0, "published": True}
    assert "nothing waiting for review" in router._template("album_status", album, "")

    found = {
        "matches": [
            {
                "name": "AYAANSH RAI",
                "admission": "5851",
                "class_name": "TULIP",
                "code": "ANL-1",
                "rsvp_status": "attending",
                "rsvp_guests": 1,
                "registered": 1,
                "checked_in": 0,
            }
        ]
    }
    text = router._template("find_family", found, "find Ayaansh Rai")
    assert "1 guest" in text and "nobody checked in yet" in text


def test_identity_clause_omits_unset_fields():
    assert (
        identity.describe({"school": "Everest Public School", "event": "Annual Function 2026"})
        == "Everest Public School's Annual Function 2026"
    )
    assert identity.describe({"school": "X", "event": "", "venue": "School Ground"}) == "X at the School Ground"
