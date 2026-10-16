import { additionalPages } from './additionalPages';
import { belowIndent } from './belowIndent';
import { capitalizeLabels } from './capitalize';
import { communityProperty } from './communityProperty';
import { inKindGate } from './inKindGate';
import { embeddedConfirmation } from './embeddedConfirmation';
import { initialBlanks } from './initialBlanks';
import { initialSelections } from './initials';
import { investorTypeTable } from './investorTypeTable';
import { monthDay } from './monthDay';
import { naNotes } from './naNotes';
import { numberedGroups } from './numberedGroups';
import { numberingFromPdf } from './numberingFromPdf';
import { optionalByNature } from './optionalByNature';
import { optionSections } from './optionSections';
import { pdfPages } from './pdfPages';
import { sameAsAbove } from './sameAsAbove';
import { specifyOther } from './specifyOther';
import { subscriberName } from './subscriberName';
import { taxForms } from './taxForms';
import { taxId } from './taxId';
import { infoWells } from './wells';
import { hiddenPage } from './hiddenPage';
import { headingCaps } from './headingCaps';
import { optionLayouts } from './optionLayouts';
import { gpFilledFields, signatureFields, signatureGroups } from './signatures';
import { signaturePage } from './signaturePage';
import { titleCaseTitles } from './titleCase';
import { yesNoLabels } from './yesNoLabels';
import { yesNoQuestions } from './yesNo';
import type { Standard, StandardContext } from './types';

/** In the order they run. Adding a standard is one entry here plus its own file and test. */
export const STANDARDS: Standard[] = [hiddenPage, taxForms, gpFilledFields, signatureFields, signatureGroups, signaturePage, numberingFromPdf, yesNoLabels, optionalByNature, taxId, subscriberName, communityProperty, initialBlanks, initialSelections, investorTypeTable, monthDay, additionalPages, specifyOther, inKindGate, sameAsAbove, optionSections, pdfPages, embeddedConfirmation, infoWells, naNotes, yesNoQuestions, optionLayouts, capitalizeLabels, titleCaseTitles, headingCaps, numberedGroups, belowIndent];

export function runStandards(ctx: StandardContext, disabled: readonly string[] = []): void {
  for (const s of STANDARDS) {
    if (!disabled.includes(s.id)) s.apply(ctx);
  }
}

export type { Standard, StandardContext };
