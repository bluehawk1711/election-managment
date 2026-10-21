"use client";

/**
 * Save/choose the WhatsApp message that the voter slip sends.
 *
 * The selector itself lives in the slip toolbar. This panel is the small
 * manager behind "संदेश जोड़ें / बदलें": it lets one signed-in account keep
 * several message drafts (one per audience, language, or campaign phase) and
 * pick them by name. The built-in slip message is always present and cannot
 * be edited or deleted; "New message" starts from whichever message is
 * selected, which makes a custom copy one click away.
 *
 * Templates are tiny placeholder strings. The tokens insert `{name}` and
 * friends, so a saved message always renders the current voter rather than
 * freezing the voter that was open when it was written.
 */
import { useRef, useState } from "react";
import {
  DEFAULT_SLIP_MESSAGE,
  DEFAULT_SLIP_MESSAGE_ID,
  SLIP_MESSAGE_TOKENS,
  type SlipMessageTemplate,
} from "@/lib/roll/slip";
import {
  MAX_SLIP_MESSAGE_BODY,
  MAX_SLIP_MESSAGE_LABEL,
  MAX_SLIP_MESSAGES,
  newSlipMessageId,
} from "@/lib/roll/slip-message-store";

export function SlipMessageManager({
  templates,
  selectedId,
  selectedTemplate,
  onTemplates,
  onSelect,
  onClose,
}: {
  templates: SlipMessageTemplate[];
  selectedId: string;
  selectedTemplate: SlipMessageTemplate;
  onTemplates: (next: SlipMessageTemplate[]) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Where the caret was when the textarea last had interaction. Clicking a
  // token chip moves focus to the chip, so reading `selectionStart` at click
  // time would lose the place; this ref carries it across that focus change.
  // `null` means "don't guess" — the token goes at the end of the draft.
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  const rememberSelection = () => {
    const field = bodyRef.current;
    if (!field) return;
    selectionRef.current = {
      start: field.selectionStart ?? field.value.length,
      end: field.selectionEnd ?? field.value.length,
    };
  };

  const startNew = () => {
    const base =
      selectedTemplate.id === DEFAULT_SLIP_MESSAGE_ID
        ? "मेरा संदेश"
        : `${selectedTemplate.label} (नया)`;
    setEditingId(newSlipMessageId());
    setLabel(base.slice(0, MAX_SLIP_MESSAGE_LABEL));
    setBody(selectedTemplate.body);
    setError(null);
    selectionRef.current = null;
  };

  const startEdit = (template: SlipMessageTemplate) => {
    setEditingId(template.id);
    setLabel(template.label);
    setBody(template.body);
    setError(null);
    selectionRef.current = null;
  };

  const cancelEdit = () => {
    setEditingId(null);
    setLabel("");
    setBody("");
    setError(null);
    selectionRef.current = null;
  };

  const insertToken = (token: string) => {
    const text = `{${token}}`;
    const field = bodyRef.current;
    const selection = selectionRef.current;
    const start = selection?.start ?? body.length;
    const end = selection?.end ?? start;
    const next = body.slice(0, start) + text + body.slice(end);
    setBody(next);
    const caret = start + text.length;
    selectionRef.current = { start: caret, end: caret };
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(caret, caret);
    });
  };

  const save = () => {
    if (!editingId) return;

    const cleanLabel = label.trim();
    const cleanBody = body.trim();
    if (!cleanLabel) {
      setError("संदेश का नाम दर्ज करें।");
      return;
    }
    if (cleanLabel.length > MAX_SLIP_MESSAGE_LABEL) {
      setError(`नाम ${MAX_SLIP_MESSAGE_LABEL} अक्षरों से छोटा रखें।`);
      return;
    }
    if (!cleanBody) {
      setError("संदेश खाली नहीं हो सकता।");
      return;
    }
    if (cleanBody.length > MAX_SLIP_MESSAGE_BODY) {
      setError(`संदेश ${MAX_SLIP_MESSAGE_BODY} अक्षरों से छोटा रखें।`);
      return;
    }

    const exists = templates.some((template) => template.id === editingId);
    if (!exists && templates.length >= MAX_SLIP_MESSAGES) {
      setError(`एक खाते में ${MAX_SLIP_MESSAGES} संदेश ही रखे जा सकते हैं।`);
      return;
    }

    const saved: SlipMessageTemplate = {
      id: editingId,
      label: cleanLabel,
      body: cleanBody,
    };
    const next = exists
      ? templates.map((template) =>
          template.id === editingId ? saved : template
        )
      : [...templates, saved];

    onTemplates(next);
    // A new draft becomes the active one; editing an inactive draft must not
    // steal the selection from the message the operator is already sending.
    if (!exists || selectedId === saved.id) onSelect(saved.id);
    setEditingId(null);
    setLabel("");
    setBody("");
    setError(null);
  };

  const remove = (id: string) => {
    const next = templates.filter((template) => template.id !== id);
    onTemplates(next);
    if (selectedId === id) onSelect(DEFAULT_SLIP_MESSAGE_ID);
    setDeletingId(null);
  };

  return (
    <div className="slip-messagePanel" aria-label="WhatsApp संदेश प्रबंधन">
      <div className="slip-messagePanelHead">
        <div>
          <div className="slip-messagePanelTitle">WhatsApp संदेश</div>
          <div className="slip-messagePanelNote">
            ये संदेश इस खाते के लिए इस ब्राउज़र में सुरक्षित रहते हैं।
          </div>
        </div>
        <button
          type="button"
          className="slip-messageMiniBtn"
          onClick={onClose}
        >
          बंद करें
        </button>
      </div>

      {editingId ? (
        <div className="slip-messageEditor">
          <label className="slip-messageField">
            <span>संदेश का नाम</span>
            <input
              className="slip-messageInput"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={MAX_SLIP_MESSAGE_LABEL}
              placeholder="जैसे: मतदाता संदेश"
              autoFocus
            />
          </label>

          <label className="slip-messageField">
            <span>संदेश</span>
            <textarea
              ref={bodyRef}
              className="slip-messageTextarea"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onSelect={rememberSelection}
              onClick={rememberSelection}
              onKeyUp={rememberSelection}
              maxLength={MAX_SLIP_MESSAGE_BODY}
              rows={6}
            />
          </label>

          <div className="slip-messageTokens">
            <span className="slip-messageTokensLabel">जानकारी जोड़ें:</span>
            {SLIP_MESSAGE_TOKENS.map(({ token, label: tokenLabel }) => (
              <button
                key={token}
                type="button"
                className="slip-messageToken"
                title={tokenLabel}
                onClick={() => insertToken(token)}
              >
                {`{${token}}`}
              </button>
            ))}
          </div>
          <div className="slip-messageHint">
            चिप पर क्लिक करने से वह जानकारी संदेश में जुड़ जाएगी। संदेश हर
            मतदाता के लिए उसी की जानकारी से भरेगा।
          </div>

          {error ? <div className="slip-messageError">{error}</div> : null}

          <div className="slip-messageActions">
            <button
              type="button"
              className="slip-messageBtn slip-messageBtnGhost"
              onClick={cancelEdit}
            >
              रद्द करें
            </button>
            <button
              type="button"
              className="slip-messageBtn slip-messageBtnPrimary"
              onClick={save}
            >
              सहेजें
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="slip-messageActions slip-messageActionsBetween">
            <span className="slip-messageCount">
              {templates.length} / {MAX_SLIP_MESSAGES} अतिरिक्त संदेश
            </span>
            <button
              type="button"
              className="slip-messageBtn slip-messageBtnPrimary"
              onClick={startNew}
              disabled={templates.length >= MAX_SLIP_MESSAGES}
            >
              + नया संदेश
            </button>
          </div>

          {templates.length === 0 ? (
            <div className="slip-messageEmpty">
              अभी कोई अतिरिक्त संदेश नहीं है। नया संदेश बनाकर उसे इस सूची में
              रखें।
            </div>
          ) : (
            <ul className="slip-messageList">
              {templates.map((template) => (
                <li
                  key={template.id}
                  className={`slip-messageItem${
                    selectedId === template.id ? " is-selected" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="slip-messageItemMain"
                    onClick={() => onSelect(template.id)}
                  >
                    <span className="slip-messageItemName">
                      {template.label}
                    </span>
                    <span className="slip-messageItemPreview">
                      {template.body.replace(/\s+/g, " ").slice(0, 100)}
                    </span>
                  </button>
                  <div className="slip-messageItemActions">
                    {deletingId === template.id ? (
                      <>
                        <span className="slip-messageDeleteAsk">हटाएँ?</span>
                        <button
                          type="button"
                          className="slip-messageMiniBtn slip-messageMiniBtnDanger"
                          onClick={() => remove(template.id)}
                        >
                          हाँ
                        </button>
                        <button
                          type="button"
                          className="slip-messageMiniBtn"
                          onClick={() => setDeletingId(null)}
                        >
                          नहीं
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="slip-messageMiniBtn"
                          onClick={() => startEdit(template)}
                        >
                          संपादित
                        </button>
                        <button
                          type="button"
                          className="slip-messageMiniBtn slip-messageMiniBtnDanger"
                          onClick={() => setDeletingId(template.id)}
                        >
                          हटाएँ
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="slip-messageDefaultNote">
            डिफ़ॉल्ट: <b>{DEFAULT_SLIP_MESSAGE.label}</b> — हमेशा उपलब्ध रहता
            है। उसे बदलने के लिए नया संदेश बनाकर संपादित करें।
          </div>
        </>
      )}
    </div>
  );
}
