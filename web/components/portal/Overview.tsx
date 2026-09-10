import type { ReactNode } from "react";
import Image from "next/image";
import Icon from "@/components/ui/Icon";
import { Star } from "@/components/landing/Playground";
import { formatDate, type EventInfo, type InvitationData } from "@/lib/types";
export default function Overview({
  event,
  data,
  invitation,
  onNavigate,
}: {
  event: EventInfo | null;
  data: InvitationData | null;
  invitation: ReactNode;
  onNavigate: (view: string) => void;
}) {
  return (
    <div>
      <div className="portal-opening">
        <section className="portal-story">
          <Star className="paper-star" size={38} />
          <div className="portal-story-copy">
            <span className="paper-note">Your seat in the story.</span>
            <h2>
              One night.
              <br />
              All of us.
            </h2>
            <p>
              The little butterflies. The big applause. An evening made for you
              and your people.
            </p>
            <button
              className="button primary"
              onClick={() => onNavigate(data ? "invitation" : "event")}
            >
              {data ? "Open my invitation" : "Explore the event"}
              <Icon name="arrow" size={15} />
            </button>
          </div>
          <Image
            src="/landing/paper-theatre.png"
            width={1254}
            height={1254}
            alt=""
            unoptimized
            className="portal-theatre"
          />
          <div className="portal-date">
            <span>
              <Icon name="calendar" size={14} />
              {formatDate(event?.eventDate, true)}
            </span>
            <span>
              <Icon name="clock" size={14} />
              {event?.startTime || "Time to be announced"}
            </span>
          </div>
        </section>
        <div className="portal-access">
          <div className="portal-access-label">
            <span>
              <Icon name="ticket" size={16} />
              Invitation access
            </span>
            <Star size={17} />
          </div>
          <div className="portal-access-body">{invitation}</div>
          <div className="portal-access-foot">
            <Icon name="heart" size={13} />
            {data
              ? "A place for you and your favourite people."
              : "A little code. A whole evening."}
          </div>
        </div>
      </div>
      <div className="portal-section-heading">
        <h2>A few little things, before the big night.</h2>
        <span>Let’s get you ready.</span>
      </div>
      <div className="portal-shortcuts">
        <button
          className="portal-shortcut"
          onClick={() => onNavigate("guests")}
        >
          <span className="shortcut-top">
            <span className="shortcut-icon">
              <Icon name="users" size={23} />
            </span>
            <span className="shortcut-doodle">the best company!</span>
          </span>
          <h3>Bring your people.</h3>
          <p>
            {data
              ? `${data.registered} registered. ${data.remaining} seats waiting for your favourite people.`
              : "Save their seats. Keep your favourite people on one invitation."}
          </p>
          <span className="shortcut-action">
            Manage guests
            <Icon name="arrow" size={16} />
          </span>
        </button>
        <button
          className="portal-shortcut peach"
          onClick={() => onNavigate("event")}
        >
          <span className="shortcut-top">
            <span className="shortcut-icon">
              <Icon name="pin" size={23} />
            </span>
            <span className="shortcut-doodle">we’ll meet you there.</span>
          </span>
          <h3>All the useful bits.</h3>
          <p>
            {event?.venue
              ? `${event.venue}. Find the dress code, parking, and the best way in.`
              : "The venue, the dress code, the best way in. All in one little place."}
          </p>
          <span className="shortcut-action">
            View event details
            <Icon name="arrow" size={16} />
          </span>
        </button>
        <button
          className="portal-shortcut mint"
          onClick={() => onNavigate("helpdesk")}
        >
          <span className="shortcut-top">
            <span className="shortcut-icon">
              <Star size={24} />
            </span>
            <span className="shortcut-doodle">glad you asked!</span>
          </span>
          <h3>A little question?</h3>
          <p>
            Ask the AI helpdesk about the evening. Answers from your school’s
            published information.
          </p>
          <span className="shortcut-action">
            Start a conversation
            <Icon name="arrow" size={16} />
          </span>
        </button>
      </div>
      <div className="portal-help-note">
        <div>
          <Icon name="heart" size={22} />
          <p>
            <strong>Sometimes, you just need a person.</strong>
            <br />
            The event team is here for the things that need a little extra care.
          </p>
        </div>
        <button className="text-button" onClick={() => onNavigate("support")}>
          Contact support
          <Icon name="arrow" size={15} />
        </button>
      </div>
    </div>
  );
}
