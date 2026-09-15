"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import { api, formatDate, type EventInfo } from "@/lib/types";
import { SCHOOL_LANDING, type LandingContent } from "@/lib/landing";
import { Reveal, Star, usePlayground } from "./Playground";

const kindIcons = {
  welcome: "sparkle",
  music: "music",
  dance: "sparkle",
  theatre: "ticket",
  celebration: "star",
};
export default function LandingPage() {
  const [event, setEvent] = useState<EventInfo | null>(null),
    [content, setContent] = useState<LandingContent>(SCHOOL_LANDING),
    [menu, setMenu] = useState(false),
    [activeProgramme, setActiveProgramme] = useState(0),
    [eventError, setEventError] = useState("");
  const { canvas, found, sound, setSound, toast, discover, burst } =
    usePlayground();
  const hero = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    api<{
      event: (EventInfo & { landingContent?: LandingContent | null }) | null;
    }>("/api/event")
      .then((r) => {
        if (live) {
          setEvent(r.event);
          if (r.event?.landingContent) setContent(r.event.landingContent);
        }
      })
      .catch(() => {
        if (live)
          setEventError(
            "We couldn’t load the latest event details. Please try refreshing in a moment.",
          );
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(false);
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const eventDate = event?.eventDate
    ? new Date(event.eventDate.slice(0, 10) + "T12:00:00")
    : null;
  const nav = [
    { href: "#the-evening", label: "The evening" },
    { href: "#our-guests", label: "Our guests" },
    { href: "#programme", label: "What’s on" },
    { href: "#good-to-know", label: "Good to know" },
  ];
  function calendar() {
    if (!event?.eventDate || !event.startTime) return;
    const time = event.startTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!time) return;
    let hour = Number(time[1]);
    if (time[3]) hour = (hour % 12) + (/pm/i.test(time[3]) ? 12 : 0);
    const escape = (s: string) =>
      s
        .replaceAll("\\", "\\\\")
        .replaceAll("\n", "\\n")
        .replaceAll(",", "\\,")
        .replaceAll(";", "\\;");
    const date = event.eventDate.replaceAll("-", "").slice(0, 8);
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Annual//School Celebration//EN",
      "BEGIN:VEVENT",
      `UID:annual-${date}@school-event.local`,
      `DTSTAMP:${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "")}`,
      `DTSTART;TZID=Asia/Kolkata:${date}T${String(hour).padStart(2, "0")}${time[2]}00`,
      `SUMMARY:${escape(event.eventName)}`,
      `LOCATION:${escape(event.venue || "")}`,
      `DESCRIPTION:${escape(event.entryInfo || "Bring your invitation QR.")}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([ics], { type: "text/calendar;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "a-sky-full-of-stories.ics";
    a.click();
    URL.revokeObjectURL(url);
  }
  const faqs = [
    {
      question: "How do we get our invitation?",
      answer:
        "Use the private invitation code shared by your school to open the invitation portal. Your digital pass and QR will be waiting there. Haven’t received a code? Your class teacher can help.",
    },
    {
      question: "How many guests can we bring?",
      answer:
        "Your personal invitation shows your guest allowance. Register each guest in the portal before the event. If you need a different allowance, send a support request for the event team to review.",
    },
    {
      question: "What should we wear?",
      answer:
        event?.dressCode || "Dress-code details will be shared by the school.",
    },
    {
      question: "Where do we park and enter?",
      answer:
        [event?.parkingInfo, event?.entryInfo].filter(Boolean).join(". ") ||
        "Parking and entry details will be shared by the school.",
    },
    {
      question: "Can you help with accessibility or a special request?",
      answer:
        content.contact +
        " You can also send an accessibility request from Support in your invitation portal.",
    },
  ];
  return (
    <div className="play-site">
      <a className="play-skip" href="#landing-main">
        Skip to the celebration
      </a>
      <canvas ref={canvas} className="confetti-layer" aria-hidden="true" />
      <header className="play-nav">
        <Link
          href="/"
          className="play-brand"
          aria-label={`${content.schoolName} home`}
        >
          <span className="brand-bloom">
            {content.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={content.logoUrl} alt="" width={30} height={30} />
            ) : (
              <Star size={30} />
            )}
          </span>
          <span>
            annual<span className="brand-period">.</span>
            <small>{content.schoolName}</small>
          </span>
        </Link>
        <nav className="desktop-play-nav" aria-label="Landing navigation">
          {nav.map((n) => (
            <a href={n.href} key={n.href}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <button
            className={`sound-switch ${sound ? "enabled" : ""}`}
            aria-label={
              sound ? "Turn surprise sounds off" : "Turn surprise sounds on"
            }
            aria-pressed={sound}
            onClick={() => setSound(!sound)}
          >
            <Icon name={sound ? "volume" : "volume-off"} size={17} />
            <span>Sound {sound ? "on" : "off"}</span>
          </button>
          <Link className="play-button small pale" href="/portal">
            Your invitation
            <Icon name="arrow" size={15} />
          </Link>
          <button
            className="play-menu-toggle"
            aria-expanded={menu}
            aria-label={menu ? "Close menu" : "Open menu"}
            onClick={() => setMenu(!menu)}
          >
            <Icon name={menu ? "close" : "menu"} />
          </button>
        </div>
      </header>
      {menu && (
        <nav className="mobile-play-nav" aria-label="Mobile landing navigation">
          {nav.map((n) => (
            <a href={n.href} onClick={() => setMenu(false)} key={n.href}>
              {n.label}
              <Icon name="arrow" />
            </a>
          ))}
          <Link href="/portal">
            Find my invitation
            <Icon name="ticket" />
          </Link>
        </nav>
      )}
      <main id="landing-main">
        <section
          className="play-hero"
          ref={hero}
          onPointerMove={(e) => {
            if (
              e.pointerType !== "mouse" ||
              window.matchMedia("(prefers-reduced-motion: reduce)").matches
            )
              return;
            const rect = e.currentTarget.getBoundingClientRect();
            e.currentTarget.style.setProperty(
              "--mouse-x",
              `${(e.clientX - rect.left - rect.width / 2) * 0.012}px`,
            );
            e.currentTarget.style.setProperty(
              "--mouse-y",
              `${(e.clientY - rect.top - rect.height / 2) * 0.012}px`,
            );
          }}
          onPointerLeave={() => {
            hero.current?.style.setProperty("--mouse-x", "0px");
            hero.current?.style.setProperty("--mouse-y", "0px");
          }}
        >
          <div className="sky-speckles" aria-hidden="true" />
          <div className="hero-story">
            <div className="handwritten invitation-note">
              <span className="little-line" />
              You’re invited to a little bit of magic.
            </div>
            <h1>
              {content.theme === SCHOOL_LANDING.theme ? (
                <>
                  <span>A sky full</span>
                  <span>
                    of <em>stories.</em>
                    <Star size={41} className="title-star" />
                  </span>
                </>
              ) : (
                content.theme
              )}
            </h1>
            <p className="hero-introduction">{content.introduction}</p>
            <div className="hero-buttons">
              <Link href="/portal" className="play-button yellow">
                Find my invitation
                <Icon name="arrow" size={19} />
              </Link>
              <a href="#the-evening" className="play-text-link">
                Let’s explore
                <Icon name="arrow-down" size={17} />
              </a>
            </div>
            <div className="hero-date">
              <div className="tiny-calendar">
                <small>
                  {eventDate
                    ? eventDate.toLocaleDateString("en-IN", { month: "short" })
                    : "Date"}
                </small>
                <strong>{eventDate ? eventDate.getDate() : "—"}</strong>
              </div>
              <div>
                <strong>
                  {eventDate
                    ? eventDate.toLocaleDateString("en-IN", { weekday: "long" })
                    : "An evening to look forward to"}
                  {event?.startTime ? `, ${event.startTime} onwards` : ""}
                </strong>
                <span>{event?.venue || "Venue details coming soon"}</span>
              </div>
            </div>
            {eventError && (
              <p className="landing-error" role="alert">
                {eventError}
              </p>
            )}
          </div>
          <div className="hero-theatre">
            <div className="theatre-halo" aria-hidden="true" />
            <Image
              src="/landing/paper-theatre.png"
              width={1254}
              height={1254}
              alt="A handmade paper theatre with lilac curtains, a glowing crescent moon, and hanging golden stars"
              priority
              unoptimized
              sizes="(max-width: 760px) 100vw, 55vw"
              className="theatre-art"
            />
            <button
              className={`hidden-star hero-hidden-star ${found.includes("hero") ? "star-found" : ""}`}
              aria-label="Discover the first hidden star"
              onClick={(e) => discover("hero", e)}
            >
              <Star size={45} />
              <span className="handwritten">psst… tap me!</span>
            </button>
            <div className="hero-sticker">
              <span>BIG DREAMS</span>
              <Icon name="heart" size={23} />
              <span>LITTLE STARS</span>
            </div>
            <span className="handwritten theatre-caption">
              Made of imagination.
              <br />
              And a whole lot of heart.
            </span>
          </div>
          <a href="#the-evening" className="scroll-invitation">
            <span>A little wonder awaits</span>
            <Icon name="arrow-down" size={17} />
          </a>
        </section>
        <div
          className="joy-ribbon"
          aria-label="An evening of music, laughter, dance, and stories"
        >
          <div className="ribbon-track">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} aria-hidden={i > 0}>
                Little stars <Star size={23} /> Big feelings <Star size={23} />{" "}
                Loud applause <Star size={23} /> Unforgettable stories{" "}
                <Star size={23} />
              </span>
            ))}
          </div>
        </div>

        <section id="the-evening" className="play-section evening-section">
          <Reveal>
            <div className="section-kicker">
              <span className="dash" />
              An evening with a little extra everything
            </div>
            <div className="section-heading-play">
              <h2>
                Not just a school night.
                <br />
                <span>A remember-this-forever night.</span>
              </h2>
              <p>
                For the first steps on stage.
                <br />
                For the proud smiles in the crowd.
                <br />
                For all the little things that become big memories.
              </p>
            </div>
          </Reveal>
          <div className="feeling-grid">
            <Reveal className="feeling-card lavender" delay={0}>
              <div className="paper-music" aria-hidden="true">
                <span>♪</span>
                <span>♫</span>
                <span>♪</span>
              </div>
              <span className="handwritten card-note">
                a little louder, please!
              </span>
              <div>
                <span className="feeling-number">Feel the rhythm</span>
                <h3>
                  Tiny feet.
                  <br />
                  Giant energy.
                </h3>
                <p>
                  Music that moves you. Dance that makes it impossible to sit
                  still.
                </p>
              </div>
            </Reveal>
            <Reveal className="feeling-card peach" delay={80}>
              <div className="paper-mask" aria-hidden="true">
                <span className="mask-eye" />
                <span className="mask-eye" />
                <span className="mask-smile" />
              </div>
              <span className="handwritten card-note">
                wait for the plot twist…
              </span>
              <div>
                <span className="feeling-number">Step into a story</span>
                <h3>
                  A whole world.
                  <br />
                  One little stage.
                </h3>
                <p>
                  Brave voices, wild imaginations, and stories told from the
                  heart.
                </p>
              </div>
            </Reveal>
            <Reveal className="feeling-card mint" delay={160}>
              <div className="paper-heart" aria-hidden="true">
                <Icon name="heart" size={85} />
                <Star size={23} />
              </div>
              <span className="handwritten card-note">
                yes, happy tears count.
              </span>
              <div>
                <span className="feeling-number">Make a memory</span>
                <h3>
                  The kind of proud
                  <br />
                  you can’t put into words.
                </h3>
                <p>
                  Save a seat for your favourite people. This is a moment for
                  all of us.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="our-guests" className="play-section guest-section">
          <Reveal>
            <div className="section-kicker">
              <span className="dash" />
              Some very special people
            </div>
            <div className="section-heading-play">
              <h2>
                Big hearts.
                <br />
                <span>Front-row seats.</span>
              </h2>
              <p>
                Meet the people joining us to celebrate
                <br />
                our young dreamers and their bright ideas.
              </p>
            </div>
          </Reveal>
          <div className="chief-grid">
            {content.guests.map((guest, i) => (
              <Reveal key={guest.name} delay={i * 70}>
                <article className={`chief-card chief-${i % 3}`}>
                  <div className="chief-portrait" aria-hidden="true">
                    <div className="portrait-arch" />
                    <span className="portrait-initials">
                      {guest.name
                        .replace(/^Dr\.\s*/, "")
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <Star className="portrait-star" size={44} />
                    <span className="chief-role">{guest.role}</span>
                    <span className="paper-tape" />
                  </div>
                  <div className="chief-copy">
                    <h3>{guest.name}</h3>
                    <span>{guest.title}</span>
                    <p>{guest.note}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
          {content.isDemo && (
            <p className="demo-footnote">
              A preview of our guest lineup. Demo names and school details will
              be replaced before the event.
            </p>
          )}
        </section>

        {content.principal?.name && (
          <section id="principal" className="play-section principal-section">
            <Reveal>
              <div className="section-kicker">
                <span className="dash" />
                From the Principal&rsquo;s desk
              </div>
            </Reveal>
            <Reveal delay={70}>
              <article className="principal-note-card">
                <span className="principal-star" aria-hidden="true">
                  <Star size={34} />
                </span>
                <div className="principal-frame">
                  {content.principal.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="principal-photo"
                      src={content.principal.photoUrl}
                      alt={`${content.principal.name}, ${content.principal.title}`}
                    />
                  ) : (
                    <span className="principal-initials" aria-hidden="true">
                      {content.principal.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                  )}
                  <span className="paper-tape" />
                </div>
                <div className="principal-copy">
                  <blockquote>{content.principal.message}</blockquote>
                  <h3>{content.principal.name}</h3>
                  <span className="principal-role">{content.principal.title}</span>
                  {content.website && (
                    <a
                      className="principal-web"
                      href={content.website}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {content.website.replace(/^https?:\/\//, "")}
                      <Icon name="arrow" size={13} />
                    </a>
                  )}
                </div>
              </article>
            </Reveal>
          </section>
        )}

        <section id="programme" className="play-section programme-section">
          <div className="programme-intro">
            <Reveal>
              <div className="section-kicker">
                <span className="dash" />
                The evening unfolds
              </div>
              <h2>
                And then…
                <br />
                <span>the magic happens.</span>
              </h2>
              <p>
                From the first welcome to that last, loud cheer.
                <br />
                Here’s a peek behind the curtain.
              </p>
              <div className="programme-scribble" aria-hidden="true">
                <svg width="112" height="100" viewBox="0 0 112 100">
                  <path
                    d="M10 8c85-13 48 88 17 52-26-30 60-9 70 21m-21-2 22 5-3-24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="handwritten">
                  tap a moment
                  <br />
                  to peek inside
                </span>
              </div>
              <button
                className={`hidden-star programme-hidden-star ${found.includes("programme") ? "star-found" : ""}`}
                aria-label="Discover the second hidden star"
                onClick={(e) => discover("programme", e)}
              >
                <Star size={45} />
                <span className="handwritten">found me?</span>
              </button>
            </Reveal>
          </div>
          <div className="programme-list">
            {content.programme.map((item, i) => (
              <Reveal key={`${item.time}-${item.title}`} delay={i * 35}>
                <article
                  className={`programme-item ${activeProgramme === i ? "open" : ""}`}
                >
                  <button
                    onClick={() =>
                      setActiveProgramme(activeProgramme === i ? -1 : i)
                    }
                    aria-expanded={activeProgramme === i}
                    aria-controls={`programme-detail-${i}`}
                  >
                    <span className="programme-time">{item.time}</span>
                    <span className={`programme-symbol symbol-${i % 3}`}>
                      <Icon
                        name={kindIcons[item.kind] || "sparkle"}
                        size={21}
                      />
                    </span>
                    <span className="programme-title">{item.title}</span>
                    <Icon name="plus" size={20} className="programme-toggle" />
                  </button>
                  <div
                    className="programme-reveal"
                    id={`programme-detail-${i}`}
                    hidden={activeProgramme !== i}
                  >
                    <p>{item.description}</p>
                  </div>
                </article>
              </Reveal>
            ))}
            {content.isDemo && (
              <p className="demo-footnote">
                Demo programme. Final timings will be published by the school.
              </p>
            )}
          </div>
        </section>

        <section className="play-section invitation-section">
          <Reveal>
            <div className="big-invitation">
              <div className="invitation-moon" aria-hidden="true" />
              <div className="invitation-message">
                <span className="handwritten">
                  We saved a little space for you.
                </span>
                <h2>
                  Your seat is waiting.
                  <br />
                  <span>So is a little magic.</span>
                </h2>
                <p>
                  One invitation. Your favourite people.
                  <br />
                  An evening you’ll be talking about on the way home.
                </p>
                <Link href="/portal" className="play-button yellow">
                  Let’s get your invitation
                  <Icon name="arrow" size={19} />
                </Link>
              </div>
              <div className="keepsake-ticket">
                <div className="ticket-stub">
                  <span>YOU + YOUR FAVOURITE PEOPLE</span>
                  <Star size={23} />
                </div>
                <div className="ticket-main">
                  <span className="ticket-caption">A little keepsake</span>
                  <h3>
                    ADMIT
                    <br />
                    <em>WONDER.</em>
                  </h3>
                  <div className="ticket-details">
                    <span>{formatDate(event?.eventDate, true)}</span>
                    <strong>{event?.startTime || "See you soon"}</strong>
                  </div>
                  <div className="ticket-perforation" />
                  <div className="ticket-bottom">
                    <span>{event?.eventName || "Annual Function"}</span>
                    <Star size={31} />
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        <section id="good-to-know" className="play-section know-section">
          <Reveal>
            <div className="section-kicker">
              <span className="dash" />A little planning, a lot more fun
            </div>
            <div className="section-heading-play">
              <h2>
                All the useful bits.
                <br />
                <span>All in one little place.</span>
              </h2>
              <p>
                So you can spend less time figuring things out
                <br />
                and more time being there.
              </p>
            </div>
          </Reveal>
          <div className="useful-grid">
            <Reveal>
              <article className="useful-card">
                <span className="useful-icon">
                  <Icon name="calendar" size={24} />
                </span>
                <small>Mark the day</small>
                <h3>{formatDate(event?.eventDate)}</h3>
                <p>
                  {event?.startTime
                    ? `The evening begins at ${event.startTime}.`
                    : "Start time to be announced."}
                </p>
                <button
                  className="play-text-link"
                  onClick={calendar}
                  disabled={!event?.eventDate || !event?.startTime}
                >
                  Add to my calendar
                  <Icon name="plus" size={16} />
                </button>
              </article>
            </Reveal>
            <Reveal delay={60}>
              <article className="useful-card">
                <span className="useful-icon">
                  <Icon name="pin" size={24} />
                </span>
                <small>Find your way</small>
                <h3>{event?.venue || "Venue to be announced"}</h3>
                <p>
                  {event?.parkingInfo || "Parking details will be shared here."}
                </p>
                <a className="play-text-link" href="#questions">
                  Parking & arrival
                  <Icon name="arrow" size={16} />
                </a>
              </article>
            </Reveal>
            <Reveal delay={120}>
              <article className="useful-card">
                <span className="useful-icon">
                  <Icon name="ticket" size={24} />
                </span>
                <small>A smooth hello</small>
                <h3>Just bring your QR.</h3>
                <p>
                  {event?.entryInfo ||
                    "Your school will share the entry instructions here."}
                </p>
                <Link className="play-text-link" href="/portal">
                  Open my pass
                  <Icon name="arrow" size={16} />
                </Link>
              </article>
            </Reveal>
          </div>
        </section>

        <section id="questions" className="play-section faq-section">
          <Reveal>
            <span className="handwritten faq-doodle">Glad you asked!</span>
            <h2>
              Little questions.
              <br />
              <span>Lovely, clear answers.</span>
            </h2>
            <p>
              Still wondering about something?
              <br />
              <Link href="/portal">
                The event helpdesk is here for you.
                <Icon name="arrow" size={14} />
              </Link>
            </p>
          </Reveal>
          <div className="faq-list">
            {faqs.map((faq, i) => (
              <Reveal key={faq.question} delay={i * 30}>
                <details className="play-faq">
                  <summary>
                    {faq.question}
                    <Icon name="plus" size={19} />
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="play-finale">
          <Reveal>
            <span className="handwritten">
              Bring your people. Bring your biggest smile.
            </span>
            <h2>
              See you
              <br />
              <em>under the stars.</em>
              <Star className="finale-star" size={60} />
            </h2>
            <div className="finale-actions">
              <Link href="/portal" className="play-button yellow">
                I’m coming. Where’s my pass?
                <Icon name="arrow" size={18} />
              </Link>
              <button
                className="applause-button"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  burst(r.left + r.width / 2, r.top);
                }}
              >
                <Icon name="heart" size={18} />A little applause for our stars
              </button>
            </div>
          </Reveal>
          <button
            className={`hidden-star footer-hidden-star ${found.includes("footer") ? "star-found" : ""}`}
            aria-label="Discover the third hidden star"
            onClick={(e) => discover("footer", e)}
          >
            <Star size={37} />
            <span className="handwritten">one last little secret…</span>
          </button>
          <div className="finale-orbit" aria-hidden="true" />
        </section>
      </main>
      <footer className="play-footer">
        <div className="footer-top">
          <Link href="/" className="play-brand">
            <span className="brand-bloom">
              <Star size={27} />
            </span>
            <span>
              annual.<small>{content.schoolName}</small>
            </span>
          </Link>
          <p>
            Made for the little moments
            <br />
            that turn into the big memories.
          </p>
          <div>
            <Link href="/portal">Invitation portal</Link>
            <Link href="/admin">Staff workspace</Link>
            <a href="#good-to-know">Event information</a>
          </div>
        </div>
        <div className="footer-contact">
          {content.contactPhone && <span>{content.contactPhone}</span>}
          {content.contactEmail && (
            <a href={`mailto:${content.contactEmail}`}>{content.contactEmail}</a>
          )}
          {content.website && (
            <a href={content.website} target="_blank" rel="noreferrer">
              {content.website.replace(/^https?:\/\//, "")}
            </a>
          )}
          {content.socials?.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          ))}
        </div>
        <div className="footer-bottom">
          <span>With heart, from {content.schoolName}.</span>
          <span className="star-counter">
            <Star size={14} />
            {found.length} of 3 little stars discovered
          </span>
          {content.isDemo && (
            <span className="preview-label">Demo preview</span>
          )}
        </div>
      </footer>
      {toast && (
        <div className="magic-toast" role="status">
          <Star size={22} />
          <span>{toast}</span>
        </div>
      )}
      <div className="mobile-invitation-dock">
        <span>
          <Star size={16} />A seat. A story. You.
        </span>
        <Link href="/portal">
          Get my invitation
          <Icon name="arrow" size={15} />
        </Link>
      </div>
    </div>
  );
}
