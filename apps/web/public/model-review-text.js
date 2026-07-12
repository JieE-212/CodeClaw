const INVISIBLE_OR_DIRECTIONAL_CONTROL = /[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}\u007f-\u009f]/gu;

export function visualizeModelReviewBody(value) {
  let controlCount = 0;
  const text = String(value ?? "").replace(INVISIBLE_OR_DIRECTIONAL_CONTROL, (character) => {
    controlCount += 1;
    return `[U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}]`;
  });
  return { text, controlCount };
}
