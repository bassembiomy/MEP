import {it,expect} from 'vitest';
import {STANDARDS_REFERENCES,resolveStandardsSelection,evaluateStandardsApplicability} from '../standards/profileRegistry';
import {ASHRAE_PROFILE,SMACNA_PROFILE} from '../standards/designStandards';
it('defaults to Egypt and identifies exact international editions without adoption claims',()=>{
 const profile=resolveStandardsSelection();expect(profile.jurisdiction).toBe('EG');
 expect(profile.references.map(r=>r.id)).toContain('ashrae-62.1-2025');
 expect(profile.issueReady).toBe(false);expect(profile.unresolved.some(s=>/Egypt/i.test(s))).toBe(true);
 expect(STANDARDS_REFERENCES.find(r=>r.id==='smacna-duct-design-5-2023')?.edition).toBe('5th edition (2023)');
});
it('supports explicit edition selection and rejects unknown identifiers',()=>{
 expect(resolveStandardsSelection({jurisdiction:'EG',referenceIds:['ashrae-62.1-2019','nfpa-90a-2024']}).references.map(r=>r.edition)).toEqual(['2019','2024']);
 expect(()=>resolveStandardsSelection({jurisdiction:'EG',referenceIds:['imaginary']})).toThrow(/unknown/i);
});
it('does not apply 62.1 nonresidential scope to dwelling units or claim a preset complies',()=>{
 const checks=evaluateStandardsApplicability(resolveStandardsSelection(),{occupancy:'nontransient-residential'});
 expect(checks.some(c=>c.referenceId==='ashrae-62.1-2025'&&c.applicable===false)).toBe(true);
 expect(ASHRAE_PROFILE.description).not.toMatch(/compliant/i);expect(SMACNA_PROFILE.description).not.toMatch(/compliant/i);
});
