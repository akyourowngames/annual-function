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


def test_arrival_questions_split_between_inside_and_outstanding():
    assert router._route("how many arrived")[0] == "checkin_status"
    assert router._route("who hasn't arrived yet")[0] == "unchecked_families"
    assert router._route("anyone still to arrive?")[0] == "unchecked_families"


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


def test_a_guest_list_question_finds_the_code_not_the_word_for():
    assert router._route("guest list for ANL-WZMCJN6FH2NQ38U6") == (
        "list_guests",
        {"code": "ANL-WZMCJN6FH2NQ38U6"},
    )
    assert router._route("guests of ANL-ABC123") == ("list_guests", {"code": "ANL-ABC123"})
    # "for" used to be captured as the code, so the lookup quietly found nobody.
    assert router._route("show me the guest list for ANL-ABC123")[1]["code"] != "for"


def test_unchecked_template_reports_the_total_not_the_sample():
    # The tool returns twelve names out of hundreds; the answer must lead with
    # the total, not read out the twelve as if they were everyone.
    result = {
        "sample": [{"name": "AARADHYA", "class_name": "5TH DAISY"}],
        "total_still_to_arrive": 463,
    }
    text = router._template("unchecked_families", result, "who hasn't arrived")
    assert "463 families" in text
    assert "AARADHYA" in text


def test_class_breakdown_template_names_every_class():
    result = {
        "classes": [
            {"class_name": "5TH DAISY", "students": 46},
            {"class_name": "TULIP", "students": 18},
        ],
        "class_count": 2,
        "total_students": 64,
    }
    text = router._template("class_breakdown", result, "how many in each class")
    assert "2 classes" in text
    assert "64 students in all" in text
    assert "5TH DAISY 46" in text and "TULIP 18" in text


def test_a_complete_list_is_long_enough_to_be_spoken():
    # The cap used to be 400 characters, which quietly sent every long list back
    # to the mechanical template. A twelve-class breakdown with the detail an
    # organizer asks for comfortably exceeds that.
    detail = [
        f"{name}, {students} students, {coming} coming with {guests} guests expected"
        for name, students, coming, guests in (
            ("5TH DAISY", 46, 40, 88),
            ("4TH DAISY", 44, 38, 84),
            ("TULIP 2", 44, 36, 79),
            ("3RD LILY", 42, 35, 77),
            ("3RD LOTUS", 42, 33, 71),
            ("2ND LILY", 38, 30, 66),
            ("2ND LOTUS", 37, 29, 62),
            ("IST LILY", 36, 27, 58),
            ("TULIP 1", 35, 26, 55),
            ("IST LOTUS", 34, 25, 53),
            ("4TH PANSY", 31, 22, 47),
            ("TULIP", 18, 14, 30),
        )
    ]
    listing = "Twelve classes, 467 students in all. " + "; ".join(detail) + "."
    assert len(listing) > 400
    assert router._looks_spoken(listing)
    assert not router._looks_spoken("x" * (router.MAX_PHRASED_CHARS + 1))


def test_identity_clause_omits_unset_fields():
    assert (
        identity.describe({"school": "Everest Public School", "event": "Annual Function 2026"})
        == "Everest Public School's Annual Function 2026"
    )
    assert identity.describe({"school": "X", "event": "", "venue": "School Ground"}) == "X at the School Ground"
