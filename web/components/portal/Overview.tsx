"use client";
import type { ReactNode } from "react";
import Card from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
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
    <div className="space-y-5">
      <div className="grid items-stretch gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card className="min-h-[390px] bg-[radial-gradient(ellipse_at_80%_0%,rgba(59,130,246,0.08),transparent_60%)] p-7 sm:p-9">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.025] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
            aria-hidden="true"
          />
          <div className="relative flex h-full flex-col">
            <div className="mb-8 flex items-center gap-2 text-[10px] font-medium tracking-[0.16em] text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 shadow-[0_0_12px_#3b82f680]" />
              ANNUAL FUNCTION / 2026
            </div>
            <h2 className="!text-[48px] !font-semibold !leading-[1.02] !tracking-[-2.8px] text-white sm:!text-[62px]">
              One night.
              <br />
              <span className="text-zinc-500">All of us.</span>
            </h2>
            <p className="mt-5 max-w-[320px] text-[13px] leading-[1.85] text-zinc-400">
              The stage. The people. The moments.
              <br />
              Your place in an evening worth remembering.
            </p>
            <div className="mb-8 mt-7 flex flex-wrap items-center gap-5">
              <button
                className="group inline-flex items-center gap-2.5 rounded-lg bg-white px-4 py-2.5 text-xs font-semibold text-black transition hover:bg-zinc-200 active:scale-[0.98]"
                onClick={() => onNavigate(data ? "invitation" : "event")}
              >
                {data ? "Open my invitation" : "Explore the event"}
                <Icon
                  name="arrow"
                  size={15}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </button>
              <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <Icon name="shield" size={13} />
                Your school. Your invitation.
              </span>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.07] pt-5 text-[11px] text-zinc-400">
              <span className="flex items-center gap-2">
                <Icon name="calendar" size={14} />
                {formatDate(event?.eventDate, true)}
              </span>
              <span className="flex items-center gap-2">
                <Icon name="clock" size={14} />
                {event?.startTime || "Time to be announced"}
              </span>
            </div>
          </div>
          <div
            className="pointer-events-none absolute right-[-48px] top-10 hidden h-36 w-36 rotate-45 rounded-[28px] border border-white/[0.05] sm:block"
            aria-hidden="true"
          >
            <div className="absolute inset-5 rounded-2xl border border-white/[0.06]" />
            <div className="absolute inset-10 rounded-lg border border-white/[0.08]" />
          </div>
        </Card>
        <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0b0b0d]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
            <span className="flex items-center gap-2 text-xs text-zinc-300">
              <Icon name="ticket" size={16} />
              Invitation access
            </span>
            <span className="font-mono text-[9px] text-zinc-500">
              PERSONAL / SECURE
            </span>
          </div>
          <div className="flex flex-1 items-center px-1 py-2 sm:px-2">
            {invitation}
          </div>
          <div className="flex items-center justify-between border-t border-dashed border-white/10 px-6 py-4">
            <span className="text-[10px] text-zinc-500">
              {data
                ? "Your family’s pass to the evening"
                : "A little code. A whole evening."}
            </span>
            <div className="flex gap-[3px] opacity-40" aria-hidden="true">
              {[2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 2, 1, 3, 1, 2, 3, 1].map(
                (w, i) => (
                  <span
                    key={i}
                    className="h-4 bg-zinc-500"
                    style={{ width: w }}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pb-0 pt-5">
        <h2 className="!text-[15px] !font-medium !tracking-normal">
          Your evening, organized.
        </h2>
        <span className="text-[10px] text-zinc-500">
          Less planning. More being there.
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <button
          className="group text-left"
          onClick={() => onNavigate("guests")}
        >
          <Card className="h-full p-6">
            <div className="mb-6 flex items-center justify-between">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.035] text-zinc-400">
                <Icon name="users" size={18} />
              </span>
              <Icon
                name="arrow"
                size={16}
                className="text-zinc-600 transition group-hover:translate-x-1 group-hover:text-white"
              />
            </div>
            <div className="mb-4 flex -space-x-2" aria-hidden="true">
              {["01", "02", "03"].map((v, i) => (
                <span
                  key={v}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-[#0b0b0d] text-[9px] ${i === 0 ? "bg-zinc-700 text-zinc-200" : i === 1 ? "bg-zinc-800 text-zinc-400" : "bg-zinc-900 text-zinc-500"}`}
                >
                  <Icon name="users" size={13} />
                </span>
              ))}
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-[#0b0b0d] bg-white/[0.035] text-zinc-500">
                <Icon name="plus" size={12} />
              </span>
            </div>
            <h3 className="!text-sm !font-medium">Bring your people.</h3>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              {data
                ? `${data.registered} registered. ${data.remaining} seats waiting for your favourite people.`
                : "Reserve their seats. Keep everyone on one invitation."}
            </p>
            <div className="mt-5 border-t border-white/[0.06] pt-4 text-[10px] text-zinc-400">
              Manage guests
            </div>
          </Card>
        </button>
        <button className="group text-left" onClick={() => onNavigate("event")}>
          <Card className="h-full p-6">
            <div className="mb-6 flex items-center justify-between">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.035] text-zinc-400">
                <Icon name="pin" size={18} />
              </span>
              <Icon
                name="arrow"
                size={16}
                className="text-zinc-600 transition group-hover:translate-x-1 group-hover:text-white"
              />
            </div>
            <div className="mb-4 flex h-8 items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
              <span className="truncate text-[10px] text-zinc-400">
                {event?.venue || "Venue to be announced"}
              </span>
            </div>
            <h3 className="!text-sm !font-medium">Know before you go.</h3>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              The venue, the dress code, the best way in. All right here.
            </p>
            <div className="mt-5 border-t border-white/[0.06] pt-4 text-[10px] text-zinc-400">
              View event details
            </div>
          </Card>
        </button>
        <button
          className="group text-left"
          onClick={() => onNavigate("helpdesk")}
        >
          <Card className="h-full bg-[radial-gradient(ellipse_at_90%_0%,rgba(59,130,246,0.06),transparent_75%)] p-6">
            <div className="mb-6 flex items-center justify-between">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-blue-400/15 bg-blue-400/[0.07] text-blue-400">
                <Icon name="sparkle" size={18} />
              </span>
              <span className="rounded-md border border-blue-400/15 bg-blue-400/[0.06] px-2 py-0.5 text-[9px] text-blue-300">
                AI helpdesk
              </span>
            </div>
            <div
              className="mb-4 flex h-8 items-center gap-[3px] text-blue-300/70"
              aria-hidden="true"
            >
              {[
                6, 10, 16, 23, 13, 28, 19, 11, 22, 30, 17, 9, 14, 21, 12, 7, 4,
              ].map((h, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-current"
                  style={{ height: h, opacity: 0.4 + (i % 3) * 0.25 }}
                />
              ))}
            </div>
            <h3 className="!text-sm !font-medium">A question? Just ask.</h3>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Answers from your school’s information. Help without the wait.
            </p>
            <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4 text-[10px] text-zinc-400">
              Start a conversation
              <Icon name="arrow" size={14} />
            </div>
          </Card>
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.015] px-5 py-4">
        <div className="flex items-center gap-3">
          <Icon name="help" size={17} className="text-zinc-500" />
          <p className="text-[11px] text-zinc-500">
            <span className="text-zinc-300">Need a human?</span> Our event team
            is a request away.
          </p>
        </div>
        <button
          className="flex items-center gap-2 text-[11px] text-zinc-400 transition hover:text-white"
          onClick={() => onNavigate("support")}
        >
          Contact support
          <Icon name="arrow" size={14} />
        </button>
      </div>
    </div>
  );
}
