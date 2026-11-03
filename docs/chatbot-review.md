# Preparedness chatbot knowledge review

The assistant may use only the selected area's server-built risk context and
the reviewed Thai knowledge base at
[`config/kb.preparedness.th.json`](../config/kb.preparedness.th.json).
Knowledge entries and emergency contacts start as drafts or empty. They are
not live recommendations or verified emergency numbers.

Before approving an entry:

1. Review language level, factual support, feasibility, and consistency with
   current official guidance.
2. Check for invented measurements, causes, times, or heights and remove
   frightening or overconfident wording.
3. Test the text with older readers and people with varied accessibility needs.
4. Verify emergency contact details directly with an official source.
5. Change `status` to `approved`, increment `version`, and set `reviewedBy`
   and `reviewedAt` to the reviewer's name and an ISO timestamp.
6. Run `npm run kb:check`. A live deployment with
   `REQUIRE_APPROVED_ADVISORIES=true` requires approval for every seeded topic
   and at least one verified official emergency contact.

Never add a phone number or local instruction based on memory or an
unverified web page. The assistant does not replace official warnings or
emergency services.
