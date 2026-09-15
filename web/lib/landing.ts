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
export type SocialLink = {
  label: string;
  url: string;
};
export type PrincipalNote = {
  name: string;
  title: string;
  message: string;
  photoUrl: string;
};
export type LandingContent = {
  schoolName: string;
  theme: string;
  introduction: string;
  guests: ChiefGuest[];
  programme: ProgrammeItem[];
  contact: string;
  isDemo: boolean;
  // Optional so already-published content keeps working.
  contactPhone?: string;
  contactEmail?: string;
  website?: string;
  socials?: SocialLink[];
  logoUrl?: string;
  principal?: PrincipalNote;
};

// Evergreen default shown before the school publishes its own details from the
// staff workspace. Replace via scripts/apply-school-profile.mjs.
export const SCHOOL_LANDING: LandingContent = {
  schoolName: "Everest Public School",
  theme: "A sky full of stories.",
  introduction:
    "For nearly four decades, Everest Public School has helped every child grow into their best self — academically, creatively and ethically. Join our Junior and Senior wings for an evening of music, dance and story, made by our students for the people who cheer them on.",
  guests: [
    {
      name: "Priti Sharma",
      title: "Principal, Everest Public School",
      role: "Our guiding light",
      note: "The quiet encouragement behind every brave first step onto the stage.",
    },
    {
      name: "J.P. Sharma",
      title: "Manager, Everest Public School",
      role: "Guest of honour",
      note: "A steward of the school and a firm believer in every child's potential.",
    },
    {
      name: "Vandana Sharma",
      title: "Vice-Principal, Everest Public School",
      role: "Guest of honour",
      note: "A champion of imagination, expression and the confidence to shine.",
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
  isDemo: false,
  contactPhone: "8750117989, 9870414878",
  contactEmail: "info@everestpublicschool.com",
  website: "https://www.everestpublicschool.com",
  socials: [
    { label: "Facebook", url: "https://m.facebook.com/EverestPublicSchool1987/" },
    { label: "YouTube", url: "https://www.youtube.com/@epsschool2802" },
    { label: "Instagram", url: "https://www.instagram.com/everestschool1987/" },
  ],
  logoUrl: "/eps/logo.jpeg",
  principal: {
    name: "Priti Sharma",
    title: "Principal, Everest Public School",
    message:
      "We help each child to start his/her journey to perfection. Our aim is to imbibe value-based education, spiritual and cultural essence in the students.",
    photoUrl: "/eps/principal.jpeg",
  },
};

// Backwards-compatible alias (older imports).
export const DEMO_LANDING = SCHOOL_LANDING;
