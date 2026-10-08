import {
  executeMasterHvacValidation,
  MasterValidationInput,
  MasterValidationReport
} from '../validation/hvacValidator';

export function adaptValidateHvacDesign(input: MasterValidationInput): MasterValidationReport {
  return executeMasterHvacValidation(input);
}
