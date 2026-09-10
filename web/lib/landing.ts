export type ChiefGuest = {
  name: string;
  title: string;
  role: string;
  note: string;
};
export type ProgrammeItem = {
  time: string;
  title: string;
  description: string;
  kind: "welcome" | "music" | "dance" | "theatre" | "celebration";
};
export type LandingContent = {
  schoolName: string;
  theme: string;
  introduction: string;
  guests: ChiefGuest[];
  programme: ProgrammeItem[];
  contact: string;
  isDemo: boolean;
};

export const DEMO_LANDING: LandingContent = {
  schoolName: "Oakfield Public School",
  theme: "A sky full of stories.",
  introduction:
    "Big dreams. Little butterflies. A whole lot of heart. Join our young stars for an evening that’s been a year in the making.",
  guests: [
    {
      name: "Dr. Meera Rao",
      title: "Educator & author",
      role: "Chief guest",
      note: "A champion of curious minds, big questions, and the beautiful things children can become.",
    },
    {
      name: "Arjun Mehta",
      title: "Theatre artist & storyteller",
      role: "Guest of honour",
      note: "Turning little stories into extraordinary worlds, one stage at a time.",
    },
    {
      name: "Ananya Sharma",
      title: "Principal, Oakfield Public School",
      role: "Our guiding light",
      note: "The quiet encouragement behind every brave first step onto the stage.",
    },
  ],
  programme: [
    {
      time: "5:00 PM",
      title: "A very warm beginning",
      description:
        "The lights come on. Our school family comes together for a welcome and the ceremonial lighting of the lamp.",
      kind: "welcome",
    },
    {
      time: "5:20 PM",
      title: "A thousand little rhythms",
      description:
        "From the first beat to the last twirl, our young dancers bring the stage to life.",
      kind: "dance",
    },
    {
      time: "6:00 PM",
      title: "Stories that take flight",
      description:
        "A little imagination, a few unexpected characters, and a world built by our young storytellers.",
      kind: "theatre",
    },
    {
      time: "6:40 PM",
      title: "Hear us shine",
      description:
        "Voices, instruments, and all the courage it takes to share your song with the world.",
      kind: "music",
    },
    {
      time: "7:15 PM",
      title: "One big, happy finale",
      description:
        "A celebration of effort, friendship, and every little victory. Bring your loudest applause.",
      kind: "celebration",
    },
  ],
  contact:
    "Your class teacher or the school office can help with invitations and special arrangements.",
  isDemo: true,
};
