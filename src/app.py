"""Streamlit UI for the credit memo covenant reviewer.

Run locally:  streamlit run src/app.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Allow `streamlit run src/app.py` from the repo root by putting the repo
# root on sys.path — otherwise absolute imports of the `src` package fail.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from src.review import DEFAULT_MODEL, PipelineError, review_memo


load_dotenv()


def _secret(name: str) -> str | None:
    """Read a secret from Streamlit secrets (cloud) or env (local .env)."""
    try:
        # st.secrets raises if no secrets file is present locally.
        val = st.secrets.get(name)  # type: ignore[attr-defined]
        if val:
            return str(val)
    except Exception:
        pass
    return os.getenv(name)


# Promote Streamlit secrets into env so review.py (which uses os.getenv)
# works unchanged when deployed on Streamlit Community Cloud.
_api_key = _secret("ANTHROPIC_API_KEY")
if _api_key and not os.getenv("ANTHROPIC_API_KEY"):
    os.environ["ANTHROPIC_API_KEY"] = _api_key

_APP_PASSWORD = _secret("APP_PASSWORD")


def _password_gate() -> bool:
    """Show a login screen if APP_PASSWORD is configured.

    Returns True when the user is authenticated (or when no password is set,
    which is the local dev mode).
    """
    if not _APP_PASSWORD:
        return True
    if st.session_state.get("authenticated"):
        return True

    st.markdown("### Sign in")
    st.caption("This demo is password-protected. Enter the password shared with you.")
    with st.form("login", clear_on_submit=False):
        pw = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Enter")
    if submitted:
        if pw == _APP_PASSWORD:
            st.session_state["authenticated"] = True
            st.rerun()
        else:
            st.error("Incorrect password.")
    return False


st.set_page_config(
    page_title="Credit Memo Covenant Reviewer",
    page_icon="[]",
    layout="wide",
)

if not _password_gate():
    st.stop()

st.title("Credit Memo Covenant Reviewer")
st.caption(
    "Upload a corporate credit memo. The agent extracts every covenant, ranks the top-5 risks "
    "with a recommended lender mitigation for each, and returns structured JSON. Risk quotes are "
    "grounded verbatim in the memo; mitigations are the officer's recommended action."
)

with st.sidebar:
    st.header("Settings")
    api_key_present = bool(os.getenv("ANTHROPIC_API_KEY"))
    st.markdown(f"**ANTHROPIC_API_KEY:** {'set' if api_key_present else 'NOT set — add to .env'}")
    model = st.text_input("Model", value=DEFAULT_MODEL, help="Any Anthropic model with vision + tool use.")
    st.markdown("---")
    st.markdown("**Architecture**")
    st.markdown(
        "1. Extract call — record_covenants tool\n"
        "2. Rank call — record_top_risks tool (top-5 + mitigation)\n"
        "3. Guardrail — verbatim-quote substring check"
    )

uploaded = st.file_uploader("Drop a credit memo PDF here", type=["pdf"])

if uploaded is not None:
    st.markdown(f"**File:** `{uploaded.name}` &nbsp; · &nbsp; **Size:** {uploaded.size / 1024:.1f} KB")

    run = st.button("Run review", type="primary", disabled=not api_key_present)

    if run:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(uploaded.getvalue())
            tmp_path = Path(tmp.name)

        result = None
        try:
            with st.spinner("Extracting covenants and ranking risks..."):
                result = review_memo(tmp_path, model=model)
        except PipelineError as e:
            st.error(f"**Could not complete the review.** {e}")
            st.caption(
                "This is a controlled error — the pipeline recognised the failure and "
                "stopped cleanly. Try a smaller memo, or edit the prompts / max_tokens "
                "in `src/` if this is a memo format we should support."
            )
        except Exception as e:  # noqa: BLE001 — surface every other error to the UI
            st.error(f"**Unexpected error.** `{type(e).__name__}: {e}`")
            st.caption(
                "This one wasn't handled. Check the terminal / Streamlit Cloud logs for "
                "the full traceback, or share it with me and I'll fix it."
            )
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass

        if result is None:
            st.stop()

        st.success(f"Extracted {len(result.covenants)} covenants and ranked top-5 risks with mitigations.")

        # -------- Memo metadata --------------------------------------------
        with st.container(border=True):
            cols = st.columns(4)
            cols[0].metric("Borrower", result.memo_metadata.borrower)
            cols[1].metric(
                "Facility size",
                f"${result.memo_metadata.facility_size_usd_m:.0f}M"
                if result.memo_metadata.facility_size_usd_m
                else "—",
            )
            cols[2].metric("Memo date", result.memo_metadata.memo_date or "—")
            cols[3].metric("Covenants found", str(len(result.covenants)))

        # -------- Top-5 risks ----------------------------------------------
        st.subheader("Top 5 covenant risks")
        for risk in result.top_risks:
            with st.container(border=True):
                st.markdown(f"### Rank {risk.rank} · {risk.covenant_name}")
                st.markdown(f"**Reasoning.** {risk.reasoning}")
                st.markdown(f"> *Memo quote:* {risk.evidence_from_memo}")
                st.markdown(f"**Recommended mitigation.** {risk.mitigation}")
                st.caption(f"Covenant id: `{risk.covenant_id}`")

        # -------- All covenants --------------------------------------------
        st.subheader("All extracted covenants")
        df = pd.DataFrame([c.model_dump() for c in result.covenants])
        preferred_cols = [
            "id", "name", "type", "category", "threshold",
            "current_value", "downside_value", "test_frequency", "source_section",
        ]
        display_cols = [c for c in preferred_cols if c in df.columns]
        st.dataframe(df[display_cols], use_container_width=True, hide_index=True)

        with st.expander("Verbatim quotes for each covenant"):
            for cov in result.covenants:
                st.markdown(f"**{cov.id} · {cov.name}** _(Section {cov.source_section})_")
                st.markdown(f"> {cov.verbatim_text}")

        # -------- Guardrail --------------------------------------------------
        qc = result.run_metadata.quote_check
        st.subheader("Guardrail: local quote verification")

        # Diagnostic: pypdf text extraction health.
        if qc.memo_text_looks_thin:
            st.info(
                f"**Note:** the local text extractor (pypdf) pulled only "
                f"**{qc.memo_text_chars:,} characters** from this PDF — usually a sign the memo is "
                f"scanned or image-based. Claude reads such PDFs natively via vision, but the local "
                f"guardrail below can only check the text layer, so it may report unverified quotes "
                f"that are in fact correct. Treat guardrail results as advisory for this document."
            )

        if qc.passed:
            st.success(f"All {qc.checked} quotes verified against the memo text.")
        else:
            st.warning(
                f"{len(qc.failures)} of {qc.checked} quotes could not be verified against the "
                f"locally-extracted memo text. This does NOT mean the model made them up — "
                f"it means the local extractor (pypdf) could not find them, which often happens "
                f"on scanned / image-heavy PDFs. Verify by opening the memo yourself."
            )
            with st.expander("Show unverified quotes"):
                for f in qc.failures:
                    st.markdown(f"- `{f.where}`")
                    st.markdown(f"  > {f.quote[:200]}{'…' if len(f.quote) >= 200 else ''}")

        # -------- Raw JSON + download --------------------------------------
        st.subheader("Raw JSON output")
        json_payload = result.model_dump_json(indent=2)
        st.download_button(
            "Download JSON",
            data=json_payload,
            file_name=f"{Path(uploaded.name).stem}_review.json",
            mime="application/json",
        )
        with st.expander("Show JSON"):
            st.code(json_payload, language="json")

        # -------- Run metadata ---------------------------------------------
        rm = result.run_metadata
        st.caption(
            f"Model: `{rm.model}` · "
            f"Extract: {rm.extract_tokens.input} in / {rm.extract_tokens.output} out · "
            f"Rank: {rm.rank_tokens.input} in / {rm.rank_tokens.output} out"
        )
else:
    st.info("Upload a PDF to get started. A sample memo is checked in at `memo/Synthetic_credit_memo_-_Meridian_Packaging_Group.pdf`.")
