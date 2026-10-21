/**
 * The voter-slip payload builder — one function that turns a roll row plus
 * its ward's metadata into the exact `VoterSlipData` the slip component
 * renders. The mock (`admin/public/clipboard-image.png`) and the reference
 * PDF (`मतदाता_पर्ची_गंगा_2.pdf`) are the design of record; this file is where
 * the DATA half of that design lives, so the component stays a pure renderer.
 *
 * Every string is Hindi-first, exactly as the slip prints in the field: the
 * roll itself is a Hindi document, the karykarta reading it thinks in Hindi,
 * and the English half of the data (`nameEn` & co.) rides along only where
 * the mock shows it — the `(Name)` gloss beside नाम.
 *
 * The candidate block (party post, name, symbol, ballot number) is NOT in the
 * roll — it is campaign configuration, so it is passed in and defaults to the
 * mock's values. When the admin panel gains a settings surface for it,
 * `CandidateInfo` is the shape to persist; nothing else here changes.
 */
import type { VoterView, WardMeta } from './types';
import { genderLabel } from './types';

/** Who the slip is FOR — the candidate whose symbol the voter votes for. */
export interface CandidateInfo {
  /** e.g. "जिला परिषद सदस्य प्रत्याशी (आमजन) - वार्ड संख्या 20, जोधपुर" */
  post: string;
  name: string;
  symbolName: string;
  ballotNo: number;
  photoUrl?: string;
}

/** The default candidate — the mock's own values, ward 20 Jodhpur. */
export const DEFAULT_CANDIDATE: CandidateInfo = {
  post: 'जिला परिषद सदस्य प्रत्याशी (आमजन) - वार्ड संख्या 20, जोधपुर',
  name: 'लक्ष्मणराम चौधरी',
  symbolName: 'कमल',
  ballotNo: 1,
};

/**
 * The slip component's data contract — kept structurally identical to the
 * pasted `VoterSlip.tsx` so that component drops in unchanged.
 */
export interface VoterSlipData {
  title: string;
  badgeText?: string;
  /** The roll's generated English copy of the voter's name — the small
   *  line under the Hindi name on the bilingual slip. */
  nameEn?: string;
  candidate?: CandidateInfo;
  rollLabel?: string;
  wardLabel?: string;
  voter: {
    name: string;
    fatherName: string;
    wardSerial: string | number;
    voterSerial: string | number;
    epic: string;
    houseNo: string | number;
    age: string | number;
    gender: string;
    photoUrl?: string;
    serialNo?: string | number;
  };
  booth: {
    number: string | number;
    name: string;
  };
  footerMessage?: string;
  votingTime?: string;
  /** Polling day, as the slip prints it under the voter block. */
  votingDate?: string;
}

/**
 * `VoterView` ⨯ `WardMeta` → the slip payload.
 *
 * The booth line comes from the WARD, not the row: one booth per ward
 * (`boothNo` + `boothAddress` + `roomNo` on `WardMeta`), so a row that lacks
 * a booth field cannot print a wrong one.
 */
export function buildSlipData(args: {
  voter: VoterView;
  ward: WardMeta | undefined;
  candidate?: CandidateInfo;
  photoUrl?: string;
}): VoterSlipData {
  const { voter, ward, candidate = DEFAULT_CANDIDATE, photoUrl } = args;
  const e = voter.effective;

  return {
    // The mock's heading: election body, ward, year — one line, bold.
    title: `जोधपुर जिला परिषद - वार्ड संख्या ${voter.wardNo} चुनाव - 2026`,
    badgeText: 'मतदाता सूचना पर्ची (VOTER SLIP)',
    candidate,
    nameEn: voter.nameEn,
    rollLabel: 'निर्वाचक नामावली: मूल नामावली (Mother Roll)',
    wardLabel: `वार्ड ${String(voter.wardNo).padStart(2, '0')}`,
    voter: {
      name: e.name,
      fatherName: e.fatherOrHusbandName,
      wardSerial: voter.wardNo,
      voterSerial: voter.serialNo,
      epic: voter.epicId,
      houseNo: e.houseNo || '—',
      age: e.age,
      gender: genderLabel(e.gender),
      photoUrl,
      serialNo: voter.serialNo,
    },
    booth: {
      number: ward?.boothNo ?? '—',
      name: ward
        ? `${ward.boothAddress} (कमरा न. ${ward.roomNo})`
        : 'बूथ पता उपलब्ध नहीं',
    },
    footerMessage: 'लोकतंत्र के इस महापर्व में अपने अमूल्य मत का प्रयोग अवश्य करें',
    votingTime: '7:00 am से 06:00 pm',
    votingDate: 'रविवार 20 अक्टूबर 2026',
  };
}

/**
 * The plain-text summary the WhatsApp button sends — the slip in one
 * message, no HTML, so it reads the same in any WhatsApp client. Kept
 * beside the builder because both must stay in step field-for-field: a slip
 * that prints the EPIC but texts a stale one is worse than no button.
 */
export function slipMessageText(data: VoterSlipData): string {
  const lines = [
    `*${data.badgeText ?? 'मतदाता सूचना पर्ची'}*`,
    data.title,
    '',
    `नाम: ${data.voter.name}`,
    `पिता का नाम: ${data.voter.fatherName}`,
    `वार्ड: ${data.voter.wardSerial} | मतदाता क्रमांक: ${data.voter.voterSerial}`,
    `EPIC: ${data.voter.epic}`,
    `मकान नंबर: ${data.voter.houseNo} | आयु/लिंग: ${data.voter.age} वर्ष / ${data.voter.gender}`,
    `मतदान बूथ: ${data.booth.number} - ${data.booth.name}`,
  ];
  if (data.votingDate) lines.push(`मतदान दिनांक: ${data.votingDate}`);
  if (data.votingTime) lines.push(`मतदान का समय: ${data.votingTime}`);
  return lines.join('\n');
}
