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
 * The slip carries VOTER data only — no candidate block. The artefact a
 * karykarta hands a household is about one voter, and the panel has no
 * candidate configuration to print from anyway; bringing one back later
 * means restoring a block, not reshaping this contract.
 */
import type { VoterView, WardMeta } from './types';
import { genderLabel } from './types';

/**
 * The slip component's data contract — the pasted `VoterSlip.tsx` minus the
 * candidate block, so the component renders exactly what the roll knows.
 */
export interface VoterSlipData {
  title: string;
  badgeText?: string;
  /** The roll's generated English copy of the voter's name — the small
   *  line under the Hindi name on the bilingual slip. */
  nameEn?: string;
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
  photoUrl?: string;
}): VoterSlipData {
  const { voter, ward, photoUrl } = args;
  const e = voter.effective;

  return {
    // The heading: panchayat election, ward, year — one line, bold.
    title: `ग्राम पंचायत चुनाव - वार्ड संख्या ${voter.wardNo} - 2026`,
    badgeText: 'मतदाता सूचना पर्ची (VOTER SLIP)',
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
    votingDate: 'शुक्रवार 30 अक्टूबर 2026',
  };
}

/* ------------------------------------------------------- WhatsApp message -- */

/**
 * One selectable WhatsApp message. `body` is a tiny placeholder template, not
 * a finished string: the same template is rendered for whichever voter's slip
 * is open, so a saved message never carries a previous voter's name or EPIC.
 *
 * These live in `localStorage` per signed-in account (see
 * `lib/roll/slip-message-store.ts`): the message belongs to the operator
 * sharing the slip, not to the campaign record. A different account on the
 * same browser gets its own list.
 */
export interface SlipMessageTemplate {
  id: string;
  label: string;
  body: string;
}

export const DEFAULT_SLIP_MESSAGE_ID = 'voter-slip';

/**
 * The built-in message the user asked for. It is deliberately data-only —
 * the same fields the paper slip prints, in the same order — and is the one
 * message that is always available even when no custom message is saved.
 */
export const DEFAULT_SLIP_MESSAGE: SlipMessageTemplate = {
  id: DEFAULT_SLIP_MESSAGE_ID,
  label: 'मतदाता सूचना पर्ची',
  body: [
    '*{badge}*',
    '{title}',
    '',
    'नाम: {name}',
    'पिता का नाम: {father}',
    'वार्ड: {ward} | मतदाता क्रमांक: {serial}',
    'EPIC: {epic}',
    'मकान नंबर: {house} | आयु/लिंग: {age} वर्ष / {gender}',
    'मतदान बूथ: {boothNo} - {booth}',
    'मतदान दिनांक: {date}',
    'मतदान का समय: {time}',
  ].join('\n'),
};

/** The tokens the message editor offers. Unknown tokens are left visible. */
export const SLIP_MESSAGE_TOKENS = [
  { token: 'name', label: 'मतदाता का नाम' },
  { token: 'father', label: 'पिता / पति का नाम' },
  { token: 'ward', label: 'वार्ड संख्या' },
  { token: 'serial', label: 'मतदाता क्रमांक' },
  { token: 'epic', label: 'EPIC संख्या' },
  { token: 'house', label: 'मकान नंबर' },
  { token: 'age', label: 'आयु' },
  { token: 'gender', label: 'लिंग' },
  { token: 'boothNo', label: 'बूथ संख्या' },
  { token: 'booth', label: 'बूथ का नाम / पता' },
  { token: 'date', label: 'मतदान दिनांक' },
  { token: 'time', label: 'मतदान का समय' },
] as const;

/**
 * Renders a saved message for one voter.
 *
 * A single pass over `{token}` keeps this predictable: values cannot inject a
 * second placeholder that the same pass would expand, and an unknown token is
 * left as typed so the sender can see and fix it instead of silently sending
 * an empty line.
 */
export function renderSlipMessage(
  body: string,
  data: VoterSlipData
): string {
  const values: Record<string, string> = {
    badge: data.badgeText ?? 'मतदाता सूचना पर्ची',
    title: data.title,
    name: data.voter.name,
    nameEn: data.nameEn ?? '',
    father: data.voter.fatherName,
    ward: String(data.voter.wardSerial),
    serial: String(data.voter.voterSerial),
    epic: data.voter.epic,
    house: String(data.voter.houseNo),
    age: String(data.voter.age),
    gender: data.voter.gender,
    boothNo: String(data.booth.number),
    booth: data.booth.name,
    date: data.votingDate ?? '',
    time: data.votingTime ?? '',
    footer: data.footerMessage ?? '',
  };

  return body
    .replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, token: string) =>
      values[token] ?? match
    )
    .trim();
}
