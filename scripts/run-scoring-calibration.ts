import {
  CALIBRATION_BASELINES,
  CALIBRATION_FIXTURES,
  runCalibrationCorpus,
} from '../src/lib/scoring/v2/calibration'

const result = runCalibrationCorpus(CALIBRATION_FIXTURES, CALIBRATION_BASELINES)
console.log(result.report)
if (!result.ok) process.exitCode = 1
