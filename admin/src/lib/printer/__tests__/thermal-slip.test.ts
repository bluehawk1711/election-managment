import { describe, expect, it } from "vitest";
import { renderThermalSlip, thermalSlipRows } from "../thermal-slip";
import type { VoterSlipData } from "../../roll/slip";

/**
 * The reference mock (`admin/public/clipboard-image.png`) as data: a flat
 * field list inside a dashed box, nine rows, no heading and no footer.
 */
function slipFixture(): VoterSlipData {
  return {
    title: "ग्राम पंचायत चुनाव - वार्ड संख्या 1 - 2026",
    badgeText: "मतदाता सूचना पर्ची (VOTER SLIP)",
    voter: {
      name: "सुकेश कुमार",
      fatherName: "अर्जुन शर्मा",
      wardSerial: 1,
      voterSerial: 1,
      epic: "CTK4949558",
      houseNo: "12",
      age: 34,
      gender: "पुरुष",
    },
    booth: {
      number: 91,
      name: "महात्मा गांधी राजकीय विद्यालय (कमरा न. 1)",
    },
    footerMessage: "लोकतंत्र के इस महापर्व में अपने अमूल्य मत का प्रयोग अवश्य करें",
    votingDate: "शुक्रवार 30 अक्टूबर 2026",
  };
}

describe("thermal slip rows", () => {
  it("prints the reference mock's nine rows, in order", () => {
    expect(thermalSlipRows(slipFixture())).toEqual([
      "वार्ड नंबर : 1",
      "मतदाता क्रम नंबर : 1",
      "नाम : सुकेश कुमार",
      "आई कार्ड : CTK4949558",
      "व्यवसाय :",
      "लिंग : पुरुष",
      "संबंधित नाम : अर्जुन शर्मा",
      "बूथ नंबर : 91",
      "बूथ : महात्मा गांधी राजकीय विद्यालय (कमरा न. 1)",
    ]);
  });

  it("keeps the blank occupation line and carries no heading or footer", () => {
    const data = slipFixture();
    const rows = thermalSlipRows(data);

    expect(rows).toHaveLength(9);
    expect(rows[4]).toBe("व्यवसाय :");

    // The flat field list has no room for the title, badge, voting day or
    // the encouragement footer — those belong to the message, not the paper.
    for (const row of rows) {
      expect(row).not.toContain(data.title);
      expect(row).not.toContain(data.badgeText ?? "");
      expect(row).not.toContain(data.footerMessage ?? "");
      expect(row).not.toContain(data.votingDate ?? "");
    }
  });

  it("fails loudly outside the browser instead of printing a blank slip", async () => {
    // The renderer needs a DOM canvas; in Node `document` does not exist.
    await expect(renderThermalSlip(slipFixture())).rejects.toThrow(
      /requires a browser document/,
    );
  });
});
