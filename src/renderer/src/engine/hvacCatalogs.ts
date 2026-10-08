import {
  EquipmentCatalogItem,
  DiffuserCatalogItem,
  DuctTypeItem,
  FittingLossDefinition,
  Nfpa90aStandardRule,
  DamperSpecification
} from './types';

/**
 * Standard System Equipment Catalog with Explicit Capabilities & Tabular Fan Curves
 * Marked with provenance metadata.
 */
export const STANDARD_EQUIPMENT_CATALOG: EquipmentCatalogItem[] = [
  {
    "id": "eq-miraco-msp-12k",
    "manufacturer": "Carrier Miraco",
    "model": "ClassiCool Pro 53QDMT-12N (1.0 Ton)",
    "systemType": "concealed",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 1,
    "totalCapacityBtuPerHour": 12050,
    "sensibleCapacityBtuPerHour": 9400,
    "heatingCapacityBtuPerHour": 13000,
    "nominalCfm": 350,
    "minCfm": 260,
    "maxCfm": 420,
    "maxRatedEspInWg": 0.35,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 260,
          "espInWg": 0.32,
          "powerKw": 0.08,
          "soundDba": 34
        },
        {
          "cfm": 350,
          "espInWg": 0.22,
          "powerKw": 0.11,
          "soundDba": 38
        },
        {
          "cfm": 420,
          "espInWg": 0.12,
          "powerKw": 0.14,
          "soundDba": 42
        }
      ]
    },
    "electricalKw": 1.05,
    "efficiency": {
      "seer": 16.8,
      "eer": 12.4,
      "copCooling": 3.63,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 38,
    "dimensionsIn": {
      "width": 27.6,
      "depth": 25,
      "height": 8.3
    },
    "connectionSizes": {
      "supplyDuct": "22\"x7\"",
      "returnDuct": "24\"x7\"",
      "liquidLine": "1/4\"",
      "gasLine": "3/8\""
    },
    "costIndex": 38,
    "provenance": {
      "source": "Carrier Miraco ClassiCool Pro MSP 53QDMT Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-miraco-msp-18k",
    "manufacturer": "Carrier Miraco",
    "model": "ClassiCool Pro 53QDMT-18N (1.5 Ton)",
    "systemType": "concealed",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 1.5,
    "totalCapacityBtuPerHour": 17470,
    "sensibleCapacityBtuPerHour": 13200,
    "heatingCapacityBtuPerHour": 19000,
    "nominalCfm": 444,
    "minCfm": 350,
    "maxCfm": 550,
    "maxRatedEspInWg": 0.4,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 350,
          "espInWg": 0.38,
          "powerKw": 0.12,
          "soundDba": 38
        },
        {
          "cfm": 444,
          "espInWg": 0.3,
          "powerKw": 0.15,
          "soundDba": 41
        },
        {
          "cfm": 550,
          "espInWg": 0.16,
          "powerKw": 0.19,
          "soundDba": 45
        }
      ]
    },
    "electricalKw": 1.45,
    "efficiency": {
      "seer": 16.5,
      "eer": 12.1,
      "copCooling": 3.55,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 41,
    "dimensionsIn": {
      "width": 35.4,
      "depth": 25.6,
      "height": 8.3
    },
    "connectionSizes": {
      "supplyDuct": "28\"x7\"",
      "returnDuct": "32\"x7\"",
      "liquidLine": "1/4\"",
      "gasLine": "1/2\""
    },
    "costIndex": 45,
    "provenance": {
      "source": "Carrier Miraco ClassiCool Pro MSP 53QDMT Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-miraco-msp-24k",
    "manufacturer": "Carrier Miraco",
    "model": "ClassiCool Pro 53QDMT-24N (2.0 Ton)",
    "systemType": "concealed",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 2,
    "totalCapacityBtuPerHour": 22355,
    "sensibleCapacityBtuPerHour": 17100,
    "heatingCapacityBtuPerHour": 24500,
    "nominalCfm": 614,
    "minCfm": 480,
    "maxCfm": 750,
    "maxRatedEspInWg": 0.45,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 480,
          "espInWg": 0.42,
          "powerKw": 0.18,
          "soundDba": 40
        },
        {
          "cfm": 614,
          "espInWg": 0.32,
          "powerKw": 0.22,
          "soundDba": 43
        },
        {
          "cfm": 750,
          "espInWg": 0.18,
          "powerKw": 0.28,
          "soundDba": 48
        }
      ]
    },
    "electricalKw": 1.88,
    "efficiency": {
      "seer": 16,
      "eer": 11.9,
      "copCooling": 3.49,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 43,
    "dimensionsIn": {
      "width": 43.3,
      "depth": 27.6,
      "height": 9.8
    },
    "connectionSizes": {
      "supplyDuct": "36\"x8\"",
      "returnDuct": "40\"x8\"",
      "liquidLine": "3/8\"",
      "gasLine": "5/8\""
    },
    "costIndex": 55,
    "provenance": {
      "source": "Carrier Miraco ClassiCool Pro MSP 53QDMT Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-miraco-msp-30k",
    "manufacturer": "Carrier Miraco",
    "model": "ClassiCool Pro 53QDMT-30N (2.5 Ton)",
    "systemType": "concealed",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 2.5,
    "totalCapacityBtuPerHour": 26450,
    "sensibleCapacityBtuPerHour": 21765,
    "heatingCapacityBtuPerHour": 29000,
    "nominalCfm": 790,
    "minCfm": 620,
    "maxCfm": 950,
    "maxRatedEspInWg": 0.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 620,
          "espInWg": 0.48,
          "powerKw": 0.24,
          "soundDba": 41
        },
        {
          "cfm": 790,
          "espInWg": 0.38,
          "powerKw": 0.3,
          "soundDba": 45
        },
        {
          "cfm": 950,
          "espInWg": 0.22,
          "powerKw": 0.38,
          "soundDba": 50
        }
      ]
    },
    "electricalKw": 2.35,
    "efficiency": {
      "seer": 15.8,
      "eer": 11.7,
      "copCooling": 3.43,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 45,
    "dimensionsIn": {
      "width": 47.2,
      "depth": 29.5,
      "height": 10.8
    },
    "connectionSizes": {
      "supplyDuct": "40\"x9\"",
      "returnDuct": "44\"x9\"",
      "liquidLine": "3/8\"",
      "gasLine": "5/8\""
    },
    "costIndex": 62,
    "provenance": {
      "source": "Carrier Miraco ClassiCool Pro MSP 53QDMT Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-miraco-msp-36k",
    "manufacturer": "Carrier Miraco",
    "model": "ClassiCool Pro 53QDMT-36N (3.0 Ton)",
    "systemType": "concealed",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 3,
    "totalCapacityBtuPerHour": 35590,
    "sensibleCapacityBtuPerHour": 27200,
    "heatingCapacityBtuPerHour": 38000,
    "nominalCfm": 1233,
    "minCfm": 950,
    "maxCfm": 1400,
    "maxRatedEspInWg": 0.6,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 950,
          "espInWg": 0.58,
          "powerKw": 0.32,
          "soundDba": 44
        },
        {
          "cfm": 1233,
          "espInWg": 0.45,
          "powerKw": 0.42,
          "soundDba": 48
        },
        {
          "cfm": 1400,
          "espInWg": 0.28,
          "powerKw": 0.52,
          "soundDba": 52
        }
      ]
    },
    "electricalKw": 2.95,
    "efficiency": {
      "seer": 15.5,
      "eer": 11.5,
      "copCooling": 3.37,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 48,
    "dimensionsIn": {
      "width": 51.2,
      "depth": 31.5,
      "height": 11.8
    },
    "connectionSizes": {
      "supplyDuct": "44\"x10\"",
      "returnDuct": "48\"x10\"",
      "liquidLine": "3/8\"",
      "gasLine": "3/4\""
    },
    "costIndex": 70,
    "provenance": {
      "source": "Carrier Miraco ClassiCool Pro MSP 53QDMT Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-miraco-msp-42k",
    "manufacturer": "Carrier Miraco",
    "model": "ClassiCool Pro 53QDMT-42N (3.5 Ton)",
    "systemType": "concealed",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 3.5,
    "totalCapacityBtuPerHour": 41000,
    "sensibleCapacityBtuPerHour": 31500,
    "heatingCapacityBtuPerHour": 44000,
    "nominalCfm": 1290,
    "minCfm": 1000,
    "maxCfm": 1550,
    "maxRatedEspInWg": 0.65,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 1000,
          "espInWg": 0.62,
          "powerKw": 0.38,
          "soundDba": 45
        },
        {
          "cfm": 1290,
          "espInWg": 0.5,
          "powerKw": 0.5,
          "soundDba": 49
        },
        {
          "cfm": 1550,
          "espInWg": 0.3,
          "powerKw": 0.64,
          "soundDba": 54
        }
      ]
    },
    "electricalKw": 3.5,
    "efficiency": {
      "seer": 15.2,
      "eer": 11.4,
      "copCooling": 3.34,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 49,
    "dimensionsIn": {
      "width": 55.1,
      "depth": 32.5,
      "height": 12.8
    },
    "connectionSizes": {
      "supplyDuct": "48\"x10\"",
      "returnDuct": "52\"x10\"",
      "liquidLine": "3/8\"",
      "gasLine": "3/4\""
    },
    "costIndex": 78,
    "provenance": {
      "source": "Carrier Miraco ClassiCool Pro MSP 53QDMT Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-miraco-msp-48k",
    "manufacturer": "Carrier Miraco",
    "model": "ClassiCool Pro 53QDMT-48N (4.0 Ton)",
    "systemType": "concealed",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 4,
    "totalCapacityBtuPerHour": 47000,
    "sensibleCapacityBtuPerHour": 36000,
    "heatingCapacityBtuPerHour": 50000,
    "nominalCfm": 1345,
    "minCfm": 1050,
    "maxCfm": 1650,
    "maxRatedEspInWg": 0.7,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 1050,
          "espInWg": 0.68,
          "powerKw": 0.42,
          "soundDba": 46
        },
        {
          "cfm": 1345,
          "espInWg": 0.54,
          "powerKw": 0.56,
          "soundDba": 50
        },
        {
          "cfm": 1650,
          "espInWg": 0.32,
          "powerKw": 0.72,
          "soundDba": 55
        }
      ]
    },
    "electricalKw": 3.95,
    "efficiency": {
      "seer": 15,
      "eer": 11.3,
      "copCooling": 3.31,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 50,
    "dimensionsIn": {
      "width": 57.1,
      "depth": 33.5,
      "height": 13.8
    },
    "connectionSizes": {
      "supplyDuct": "50\"x11\"",
      "returnDuct": "54\"x11\"",
      "liquidLine": "3/8\"",
      "gasLine": "7/8\""
    },
    "costIndex": 82,
    "provenance": {
      "source": "Carrier Miraco ClassiCool Pro MSP 53QDMT Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-miraco-msp-60k",
    "manufacturer": "Carrier Miraco",
    "model": "ClassiCool Pro 53QDMT-60N (5.0 Ton)",
    "systemType": "concealed",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 5,
    "totalCapacityBtuPerHour": 53000,
    "sensibleCapacityBtuPerHour": 38500,
    "heatingCapacityBtuPerHour": 56000,
    "nominalCfm": 1500,
    "minCfm": 1100,
    "maxCfm": 1800,
    "maxRatedEspInWg": 0.75,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 1100,
          "espInWg": 0.72,
          "powerKw": 0.45,
          "soundDba": 46
        },
        {
          "cfm": 1500,
          "espInWg": 0.55,
          "powerKw": 0.6,
          "soundDba": 50
        },
        {
          "cfm": 1800,
          "espInWg": 0.35,
          "powerKw": 0.78,
          "soundDba": 56
        }
      ]
    },
    "electricalKw": 4.3,
    "efficiency": {
      "seer": 15,
      "eer": 11.2,
      "copCooling": 3.28,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 50,
    "dimensionsIn": {
      "width": 59.1,
      "depth": 33.5,
      "height": 13.8
    },
    "connectionSizes": {
      "supplyDuct": "52\"x11\"",
      "returnDuct": "56\"x11\"",
      "liquidLine": "3/8\"",
      "gasLine": "7/8\""
    },
    "costIndex": 85,
    "provenance": {
      "source": "Carrier Miraco ClassiCool Pro MSP 53QDMT Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-03",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-03 (3 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 3,
    "totalCapacityBtuPerHour": 36000,
    "sensibleCapacityBtuPerHour": 28000,
    "heatingCapacityBtuPerHour": 39600,
    "nominalCfm": 1200,
    "minCfm": 800,
    "maxCfm": 1500,
    "maxRatedEspInWg": 1.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 800,
          "espInWg": 1.42,
          "powerKw": 1.4,
          "soundDba": 48
        },
        {
          "cfm": 1200,
          "espInWg": 1.2,
          "powerKw": 2.8,
          "soundDba": 54
        },
        {
          "cfm": 1500,
          "espInWg": 0.9,
          "powerKw": 3.92,
          "soundDba": 60
        }
      ]
    },
    "electricalKw": 2.8,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 54,
    "dimensionsIn": {
      "width": 38,
      "depth": 46,
      "height": 32
    },
    "connectionSizes": {
      "supplyDuct": "18\"x14\"",
      "returnDuct": "20\"x14\""
    },
    "costIndex": 85,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-06",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-06 (5 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 5,
    "totalCapacityBtuPerHour": 60000,
    "sensibleCapacityBtuPerHour": 46000,
    "heatingCapacityBtuPerHour": 66000,
    "nominalCfm": 2000,
    "minCfm": 1400,
    "maxCfm": 2500,
    "maxRatedEspInWg": 1.6,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 1400,
          "espInWg": 1.52,
          "powerKw": 2.25,
          "soundDba": 52
        },
        {
          "cfm": 2000,
          "espInWg": 1.28,
          "powerKw": 4.5,
          "soundDba": 58
        },
        {
          "cfm": 2500,
          "espInWg": 0.96,
          "powerKw": 6.3,
          "soundDba": 64
        }
      ]
    },
    "electricalKw": 4.5,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 58,
    "dimensionsIn": {
      "width": 44,
      "depth": 54,
      "height": 38
    },
    "connectionSizes": {
      "supplyDuct": "22\"x16\"",
      "returnDuct": "24\"x16\""
    },
    "costIndex": 88,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-08",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-08 (7.5 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 7.5,
    "totalCapacityBtuPerHour": 90000,
    "sensibleCapacityBtuPerHour": 69000,
    "heatingCapacityBtuPerHour": 99000,
    "nominalCfm": 3000,
    "minCfm": 2000,
    "maxCfm": 3800,
    "maxRatedEspInWg": 1.75,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 2000,
          "espInWg": 1.66,
          "powerKw": 3.4,
          "soundDba": 56
        },
        {
          "cfm": 3000,
          "espInWg": 1.4,
          "powerKw": 6.8,
          "soundDba": 62
        },
        {
          "cfm": 3800,
          "espInWg": 1.05,
          "powerKw": 9.52,
          "soundDba": 68
        }
      ]
    },
    "electricalKw": 6.8,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 62,
    "dimensionsIn": {
      "width": 52,
      "depth": 64,
      "height": 44
    },
    "connectionSizes": {
      "supplyDuct": "26\"x18\"",
      "returnDuct": "28\"x18\""
    },
    "costIndex": 90,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-10",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-10 (10 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 10,
    "totalCapacityBtuPerHour": 120000,
    "sensibleCapacityBtuPerHour": 92000,
    "heatingCapacityBtuPerHour": 132000,
    "nominalCfm": 4000,
    "minCfm": 2600,
    "maxCfm": 5000,
    "maxRatedEspInWg": 1.8,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 2600,
          "espInWg": 1.71,
          "powerKw": 4.4,
          "soundDba": 58
        },
        {
          "cfm": 4000,
          "espInWg": 1.44,
          "powerKw": 8.8,
          "soundDba": 64
        },
        {
          "cfm": 5000,
          "espInWg": 1.08,
          "powerKw": 12.32,
          "soundDba": 70
        }
      ]
    },
    "electricalKw": 8.8,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 64,
    "dimensionsIn": {
      "width": 60,
      "depth": 72,
      "height": 50
    },
    "connectionSizes": {
      "supplyDuct": "30\"x20\"",
      "returnDuct": "32\"x20\""
    },
    "costIndex": 92,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-14",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-14 (15 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 15,
    "totalCapacityBtuPerHour": 180000,
    "sensibleCapacityBtuPerHour": 138000,
    "heatingCapacityBtuPerHour": 198000,
    "nominalCfm": 6000,
    "minCfm": 3500,
    "maxCfm": 7500,
    "maxRatedEspInWg": 1.8,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 3500,
          "espInWg": 1.71,
          "powerKw": 6.25,
          "soundDba": 62
        },
        {
          "cfm": 6000,
          "espInWg": 1.44,
          "powerKw": 12.5,
          "soundDba": 68
        },
        {
          "cfm": 7500,
          "espInWg": 1.08,
          "powerKw": 17.5,
          "soundDba": 74
        }
      ]
    },
    "electricalKw": 12.5,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 68,
    "dimensionsIn": {
      "width": 72,
      "depth": 84,
      "height": 60
    },
    "connectionSizes": {
      "supplyDuct": "36\"x24\"",
      "returnDuct": "36\"x24\""
    },
    "costIndex": 96,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-20",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-20 (20 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 20,
    "totalCapacityBtuPerHour": 240000,
    "sensibleCapacityBtuPerHour": 184000,
    "heatingCapacityBtuPerHour": 264000,
    "nominalCfm": 8000,
    "minCfm": 5000,
    "maxCfm": 10000,
    "maxRatedEspInWg": 2,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 5000,
          "espInWg": 1.9,
          "powerKw": 8.25,
          "soundDba": 64
        },
        {
          "cfm": 8000,
          "espInWg": 1.6,
          "powerKw": 16.5,
          "soundDba": 70
        },
        {
          "cfm": 10000,
          "espInWg": 1.2,
          "powerKw": 23.1,
          "soundDba": 76
        }
      ]
    },
    "electricalKw": 16.5,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 70,
    "dimensionsIn": {
      "width": 84,
      "depth": 96,
      "height": 68
    },
    "connectionSizes": {
      "supplyDuct": "42\"x26\"",
      "returnDuct": "42\"x26\""
    },
    "costIndex": 98,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-25",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-25 (25 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 25,
    "totalCapacityBtuPerHour": 300000,
    "sensibleCapacityBtuPerHour": 230000,
    "heatingCapacityBtuPerHour": 330000,
    "nominalCfm": 10000,
    "minCfm": 6500,
    "maxCfm": 12500,
    "maxRatedEspInWg": 2.1,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 6500,
          "espInWg": 1.99,
          "powerKw": 10.25,
          "soundDba": 65
        },
        {
          "cfm": 10000,
          "espInWg": 1.68,
          "powerKw": 20.5,
          "soundDba": 71
        },
        {
          "cfm": 12500,
          "espInWg": 1.26,
          "powerKw": 28.7,
          "soundDba": 77
        }
      ]
    },
    "electricalKw": 20.5,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 71,
    "dimensionsIn": {
      "width": 90,
      "depth": 102,
      "height": 72
    },
    "connectionSizes": {
      "supplyDuct": "45\"x28\"",
      "returnDuct": "45\"x28\""
    },
    "costIndex": 99,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-30",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-30 (30 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 30,
    "totalCapacityBtuPerHour": 360000,
    "sensibleCapacityBtuPerHour": 275000,
    "heatingCapacityBtuPerHour": 396000,
    "nominalCfm": 12000,
    "minCfm": 8000,
    "maxCfm": 14500,
    "maxRatedEspInWg": 2.2,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 8000,
          "espInWg": 2.09,
          "powerKw": 12,
          "soundDba": 67
        },
        {
          "cfm": 12000,
          "espInWg": 1.76,
          "powerKw": 24,
          "soundDba": 73
        },
        {
          "cfm": 14500,
          "espInWg": 1.32,
          "powerKw": 33.6,
          "soundDba": 79
        }
      ]
    },
    "electricalKw": 24,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 73,
    "dimensionsIn": {
      "width": 98,
      "depth": 110,
      "height": 76
    },
    "connectionSizes": {
      "supplyDuct": "48\"x30\"",
      "returnDuct": "48\"x30\""
    },
    "costIndex": 100,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-40",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-40 (40 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 40,
    "totalCapacityBtuPerHour": 480000,
    "sensibleCapacityBtuPerHour": 365000,
    "heatingCapacityBtuPerHour": 528000,
    "nominalCfm": 16000,
    "minCfm": 11000,
    "maxCfm": 19500,
    "maxRatedEspInWg": 2.3,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 11000,
          "espInWg": 2.18,
          "powerKw": 15.5,
          "soundDba": 69
        },
        {
          "cfm": 16000,
          "espInWg": 1.84,
          "powerKw": 31,
          "soundDba": 75
        },
        {
          "cfm": 19500,
          "espInWg": 1.38,
          "powerKw": 43.4,
          "soundDba": 81
        }
      ]
    },
    "electricalKw": 31,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 75,
    "dimensionsIn": {
      "width": 112,
      "depth": 125,
      "height": 84
    },
    "connectionSizes": {
      "supplyDuct": "54\"x34\"",
      "returnDuct": "54\"x34\""
    },
    "costIndex": 105,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-50",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-50 (50 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 50,
    "totalCapacityBtuPerHour": 600000,
    "sensibleCapacityBtuPerHour": 460000,
    "heatingCapacityBtuPerHour": 660000,
    "nominalCfm": 20000,
    "minCfm": 14000,
    "maxCfm": 24000,
    "maxRatedEspInWg": 2.4,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 14000,
          "espInWg": 2.28,
          "powerKw": 19.75,
          "soundDba": 71
        },
        {
          "cfm": 20000,
          "espInWg": 1.92,
          "powerKw": 39.5,
          "soundDba": 77
        },
        {
          "cfm": 24000,
          "espInWg": 1.44,
          "powerKw": 55.3,
          "soundDba": 83
        }
      ]
    },
    "electricalKw": 39.5,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 77,
    "dimensionsIn": {
      "width": 124,
      "depth": 140,
      "height": 92
    },
    "connectionSizes": {
      "supplyDuct": "60\"x38\"",
      "returnDuct": "60\"x38\""
    },
    "costIndex": 110,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-60",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-60 (60 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 60,
    "totalCapacityBtuPerHour": 720000,
    "sensibleCapacityBtuPerHour": 550000,
    "heatingCapacityBtuPerHour": 792000,
    "nominalCfm": 24000,
    "minCfm": 16000,
    "maxCfm": 29000,
    "maxRatedEspInWg": 2.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 16000,
          "espInWg": 2.38,
          "powerKw": 24,
          "soundDba": 73
        },
        {
          "cfm": 24000,
          "espInWg": 2,
          "powerKw": 48,
          "soundDba": 79
        },
        {
          "cfm": 29000,
          "espInWg": 1.5,
          "powerKw": 67.2,
          "soundDba": 85
        }
      ]
    },
    "electricalKw": 48,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 79,
    "dimensionsIn": {
      "width": 136,
      "depth": 155,
      "height": 100
    },
    "connectionSizes": {
      "supplyDuct": "66\"x42\"",
      "returnDuct": "66\"x42\""
    },
    "costIndex": 115,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-75",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-75 (75 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 75,
    "totalCapacityBtuPerHour": 900000,
    "sensibleCapacityBtuPerHour": 690000,
    "heatingCapacityBtuPerHour": 990000,
    "nominalCfm": 30000,
    "minCfm": 20000,
    "maxCfm": 36000,
    "maxRatedEspInWg": 2.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 20000,
          "espInWg": 2.38,
          "powerKw": 30,
          "soundDba": 75
        },
        {
          "cfm": 30000,
          "espInWg": 2,
          "powerKw": 60,
          "soundDba": 81
        },
        {
          "cfm": 36000,
          "espInWg": 1.5,
          "powerKw": 84,
          "soundDba": 87
        }
      ]
    },
    "electricalKw": 60,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 81,
    "dimensionsIn": {
      "width": 148,
      "depth": 170,
      "height": 110
    },
    "connectionSizes": {
      "supplyDuct": "72\"x48\"",
      "returnDuct": "72\"x48\""
    },
    "costIndex": 120,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-carrier-aero-39m-100",
    "manufacturer": "Carrier",
    "model": "Aero Express 39M-100 (100 Ton AHU)",
    "systemType": "ahu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 100,
    "totalCapacityBtuPerHour": 1200000,
    "sensibleCapacityBtuPerHour": 920000,
    "heatingCapacityBtuPerHour": 1320000,
    "nominalCfm": 40000,
    "minCfm": 26000,
    "maxCfm": 48000,
    "maxRatedEspInWg": 2.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 26000,
          "espInWg": 2.38,
          "powerKw": 40,
          "soundDba": 77
        },
        {
          "cfm": 40000,
          "espInWg": 2,
          "powerKw": 80,
          "soundDba": 83
        },
        {
          "cfm": 48000,
          "espInWg": 1.5,
          "powerKw": 112,
          "soundDba": 89
        }
      ]
    },
    "electricalKw": 80,
    "efficiency": {
      "copCooling": 4.6,
      "iplv": 21.5,
      "ratingStandard": "AHRI 430",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 83,
    "dimensionsIn": {
      "width": 165,
      "depth": 190,
      "height": 125
    },
    "connectionSizes": {
      "supplyDuct": "84\"x54\"",
      "returnDuct": "84\"x54\""
    },
    "costIndex": 130,
    "provenance": {
      "source": "Carrier Aero Express Air Handling Selection Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-apmr-05",
    "manufacturer": "SKM",
    "model": "APMR-5005 (5 Ton RTU)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 5,
    "totalCapacityBtuPerHour": 60000,
    "sensibleCapacityBtuPerHour": 46000,
    "heatingCapacityBtuPerHour": 63000,
    "nominalCfm": 2000,
    "minCfm": 1500,
    "maxCfm": 2400,
    "maxRatedEspInWg": 1,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 1500,
          "espInWg": 0.95,
          "powerKw": 1.2,
          "soundDba": 64
        },
        {
          "cfm": 2000,
          "espInWg": 0.8,
          "powerKw": 1.68,
          "soundDba": 68
        },
        {
          "cfm": 2400,
          "espInWg": 0.55,
          "powerKw": 2.4,
          "soundDba": 72
        }
      ]
    },
    "electricalKw": 4.8,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 68,
    "dimensionsIn": {
      "width": 74,
      "depth": 48,
      "height": 42
    },
    "connectionSizes": {
      "supplyDuct": "18\"x18\"",
      "returnDuct": "18\"x18\""
    },
    "costIndex": 74,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-apmr-075",
    "manufacturer": "SKM",
    "model": "APMR-5075 (7.5 Ton RTU)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 7.5,
    "totalCapacityBtuPerHour": 90000,
    "sensibleCapacityBtuPerHour": 68000,
    "heatingCapacityBtuPerHour": 94500,
    "nominalCfm": 3000,
    "minCfm": 2400,
    "maxCfm": 3600,
    "maxRatedEspInWg": 1.2,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 2400,
          "espInWg": 1.14,
          "powerKw": 1.8,
          "soundDba": 68
        },
        {
          "cfm": 3000,
          "espInWg": 0.96,
          "powerKw": 2.52,
          "soundDba": 72
        },
        {
          "cfm": 3600,
          "espInWg": 0.66,
          "powerKw": 3.6,
          "soundDba": 76
        }
      ]
    },
    "electricalKw": 7.2,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 72,
    "dimensionsIn": {
      "width": 88,
      "depth": 59,
      "height": 49
    },
    "connectionSizes": {
      "supplyDuct": "20\"x20\"",
      "returnDuct": "20\"x20\""
    },
    "costIndex": 82,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-apmr-10",
    "manufacturer": "SKM",
    "model": "APMR-5100 (10 Ton RTU)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 10,
    "totalCapacityBtuPerHour": 120000,
    "sensibleCapacityBtuPerHour": 92000,
    "heatingCapacityBtuPerHour": 126000,
    "nominalCfm": 4000,
    "minCfm": 3000,
    "maxCfm": 4800,
    "maxRatedEspInWg": 1.25,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 3000,
          "espInWg": 1.19,
          "powerKw": 2.4,
          "soundDba": 70
        },
        {
          "cfm": 4000,
          "espInWg": 1,
          "powerKw": 3.36,
          "soundDba": 74
        },
        {
          "cfm": 4800,
          "espInWg": 0.69,
          "powerKw": 4.8,
          "soundDba": 78
        }
      ]
    },
    "electricalKw": 9.6,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 74,
    "dimensionsIn": {
      "width": 96,
      "depth": 64,
      "height": 52
    },
    "connectionSizes": {
      "supplyDuct": "24\"x24\"",
      "returnDuct": "24\"x24\""
    },
    "costIndex": 88,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-apmr-125",
    "manufacturer": "SKM",
    "model": "APMR-5125 (12.5 Ton RTU)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 12.5,
    "totalCapacityBtuPerHour": 150000,
    "sensibleCapacityBtuPerHour": 115000,
    "heatingCapacityBtuPerHour": 157500,
    "nominalCfm": 5000,
    "minCfm": 3800,
    "maxCfm": 6000,
    "maxRatedEspInWg": 1.3,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 3800,
          "espInWg": 1.23,
          "powerKw": 3,
          "soundDba": 71
        },
        {
          "cfm": 5000,
          "espInWg": 1.04,
          "powerKw": 4.2,
          "soundDba": 75
        },
        {
          "cfm": 6000,
          "espInWg": 0.72,
          "powerKw": 6,
          "soundDba": 79
        }
      ]
    },
    "electricalKw": 12,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 75,
    "dimensionsIn": {
      "width": 102,
      "depth": 68,
      "height": 55
    },
    "connectionSizes": {
      "supplyDuct": "26\"x26\"",
      "returnDuct": "26\"x26\""
    },
    "costIndex": 91,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-apmr-15",
    "manufacturer": "SKM",
    "model": "APMR-5150 (15 Ton RTU)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 15,
    "totalCapacityBtuPerHour": 180000,
    "sensibleCapacityBtuPerHour": 138000,
    "heatingCapacityBtuPerHour": 189000,
    "nominalCfm": 6000,
    "minCfm": 4500,
    "maxCfm": 7200,
    "maxRatedEspInWg": 1.4,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 4500,
          "espInWg": 1.33,
          "powerKw": 3.63,
          "soundDba": 72
        },
        {
          "cfm": 6000,
          "espInWg": 1.12,
          "powerKw": 5.07,
          "soundDba": 76
        },
        {
          "cfm": 7200,
          "espInWg": 0.77,
          "powerKw": 7.25,
          "soundDba": 80
        }
      ]
    },
    "electricalKw": 14.5,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 76,
    "dimensionsIn": {
      "width": 110,
      "depth": 72,
      "height": 58
    },
    "connectionSizes": {
      "supplyDuct": "28\"x28\"",
      "returnDuct": "28\"x28\""
    },
    "costIndex": 94,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-apmr-20",
    "manufacturer": "SKM",
    "model": "APMR-5200 (20 Ton RTU)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 20,
    "totalCapacityBtuPerHour": 240000,
    "sensibleCapacityBtuPerHour": 184000,
    "heatingCapacityBtuPerHour": 252000,
    "nominalCfm": 8000,
    "minCfm": 6000,
    "maxCfm": 9600,
    "maxRatedEspInWg": 1.45,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 6000,
          "espInWg": 1.38,
          "powerKw": 4.8,
          "soundDba": 73
        },
        {
          "cfm": 8000,
          "espInWg": 1.16,
          "powerKw": 6.72,
          "soundDba": 77
        },
        {
          "cfm": 9600,
          "espInWg": 0.8,
          "powerKw": 9.6,
          "soundDba": 81
        }
      ]
    },
    "electricalKw": 19.2,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 77,
    "dimensionsIn": {
      "width": 120,
      "depth": 78,
      "height": 62
    },
    "connectionSizes": {
      "supplyDuct": "32\"x32\"",
      "returnDuct": "32\"x32\""
    },
    "costIndex": 98,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-apmr-25",
    "manufacturer": "SKM",
    "model": "APMR-5250 (25 Ton RTU)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 25,
    "totalCapacityBtuPerHour": 300000,
    "sensibleCapacityBtuPerHour": 230000,
    "heatingCapacityBtuPerHour": 315000,
    "nominalCfm": 10000,
    "minCfm": 7500,
    "maxCfm": 12000,
    "maxRatedEspInWg": 1.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 7500,
          "espInWg": 1.42,
          "powerKw": 6,
          "soundDba": 74
        },
        {
          "cfm": 10000,
          "espInWg": 1.2,
          "powerKw": 8.4,
          "soundDba": 78
        },
        {
          "cfm": 12000,
          "espInWg": 0.83,
          "powerKw": 12,
          "soundDba": 82
        }
      ]
    },
    "electricalKw": 24,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 78,
    "dimensionsIn": {
      "width": 130,
      "depth": 84,
      "height": 66
    },
    "connectionSizes": {
      "supplyDuct": "34\"x34\"",
      "returnDuct": "34\"x34\""
    },
    "costIndex": 102,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-apmr-30",
    "manufacturer": "SKM",
    "model": "APMR-5300 (30 Ton RTU)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 30,
    "totalCapacityBtuPerHour": 360000,
    "sensibleCapacityBtuPerHour": 276000,
    "heatingCapacityBtuPerHour": 378000,
    "nominalCfm": 12000,
    "minCfm": 9000,
    "maxCfm": 14400,
    "maxRatedEspInWg": 1.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 9000,
          "espInWg": 1.42,
          "powerKw": 7.25,
          "soundDba": 76
        },
        {
          "cfm": 12000,
          "espInWg": 1.2,
          "powerKw": 10.15,
          "soundDba": 80
        },
        {
          "cfm": 14400,
          "espInWg": 0.83,
          "powerKw": 14.5,
          "soundDba": 84
        }
      ]
    },
    "electricalKw": 29,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 80,
    "dimensionsIn": {
      "width": 142,
      "depth": 90,
      "height": 70
    },
    "connectionSizes": {
      "supplyDuct": "38\"x38\"",
      "returnDuct": "38\"x38\""
    },
    "costIndex": 106,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-pacs-40",
    "manufacturer": "SKM",
    "model": "PACS-5400 (40 Ton Packaged Unit)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 40,
    "totalCapacityBtuPerHour": 480000,
    "sensibleCapacityBtuPerHour": 368000,
    "heatingCapacityBtuPerHour": 504000,
    "nominalCfm": 16000,
    "minCfm": 12000,
    "maxCfm": 19000,
    "maxRatedEspInWg": 1.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 12000,
          "espInWg": 1.42,
          "powerKw": 9.63,
          "soundDba": 78
        },
        {
          "cfm": 16000,
          "espInWg": 1.2,
          "powerKw": 13.47,
          "soundDba": 82
        },
        {
          "cfm": 19000,
          "espInWg": 0.83,
          "powerKw": 19.25,
          "soundDba": 86
        }
      ]
    },
    "electricalKw": 38.5,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 82,
    "dimensionsIn": {
      "width": 160,
      "depth": 98,
      "height": 76
    },
    "connectionSizes": {
      "supplyDuct": "44\"x44\"",
      "returnDuct": "44\"x44\""
    },
    "costIndex": 112,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-pacs-50",
    "manufacturer": "SKM",
    "model": "PACS-5500 (50 Ton Packaged Unit)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 50,
    "totalCapacityBtuPerHour": 600000,
    "sensibleCapacityBtuPerHour": 460000,
    "heatingCapacityBtuPerHour": 630000,
    "nominalCfm": 20000,
    "minCfm": 15000,
    "maxCfm": 24000,
    "maxRatedEspInWg": 1.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 15000,
          "espInWg": 1.42,
          "powerKw": 12,
          "soundDba": 80
        },
        {
          "cfm": 20000,
          "espInWg": 1.2,
          "powerKw": 16.8,
          "soundDba": 84
        },
        {
          "cfm": 24000,
          "espInWg": 0.83,
          "powerKw": 24,
          "soundDba": 88
        }
      ]
    },
    "electricalKw": 48,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 84,
    "dimensionsIn": {
      "width": 175,
      "depth": 108,
      "height": 82
    },
    "connectionSizes": {
      "supplyDuct": "48\"x48\"",
      "returnDuct": "48\"x48\""
    },
    "costIndex": 118,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-pacs-75",
    "manufacturer": "SKM",
    "model": "PACS-5750 (75 Ton Packaged Unit)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 75,
    "totalCapacityBtuPerHour": 900000,
    "sensibleCapacityBtuPerHour": 690000,
    "heatingCapacityBtuPerHour": 945000,
    "nominalCfm": 30000,
    "minCfm": 22500,
    "maxCfm": 36000,
    "maxRatedEspInWg": 1.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 22500,
          "espInWg": 1.42,
          "powerKw": 18,
          "soundDba": 82
        },
        {
          "cfm": 30000,
          "espInWg": 1.2,
          "powerKw": 25.2,
          "soundDba": 86
        },
        {
          "cfm": 36000,
          "espInWg": 0.83,
          "powerKw": 36,
          "soundDba": 90
        }
      ]
    },
    "electricalKw": 72,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 86,
    "dimensionsIn": {
      "width": 200,
      "depth": 120,
      "height": 90
    },
    "connectionSizes": {
      "supplyDuct": "58\"x58\"",
      "returnDuct": "58\"x58\""
    },
    "costIndex": 126,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-skm-pacs-100",
    "manufacturer": "SKM",
    "model": "PACS-51000 (100 Ton Packaged Unit)",
    "systemType": "packaged",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": false,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 100,
    "totalCapacityBtuPerHour": 1200000,
    "sensibleCapacityBtuPerHour": 920000,
    "heatingCapacityBtuPerHour": 1260000,
    "nominalCfm": 38000,
    "minCfm": 28500,
    "maxCfm": 45000,
    "maxRatedEspInWg": 1.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 28500,
          "espInWg": 1.42,
          "powerKw": 24,
          "soundDba": 84
        },
        {
          "cfm": 38000,
          "espInWg": 1.2,
          "powerKw": 33.6,
          "soundDba": 88
        },
        {
          "cfm": 45000,
          "espInWg": 0.83,
          "powerKw": 48,
          "soundDba": 92
        }
      ]
    },
    "electricalKw": 96,
    "efficiency": {
      "seer": 15.5,
      "eer": 12.2,
      "copCooling": 3.58,
      "iplv": 16.5,
      "ratingStandard": "AHRI 340/360",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 88,
    "dimensionsIn": {
      "width": 230,
      "depth": 135,
      "height": 100
    },
    "connectionSizes": {
      "supplyDuct": "66\"x66\"",
      "returnDuct": "66\"x66\""
    },
    "costIndex": 135,
    "provenance": {
      "source": "SKM Packaged Air Conditioners Catalog (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-toshiba-vrf-8hp",
    "manufacturer": "Toshiba",
    "model": "SMMS-e MMY-MAP0806HT8P (8 HP / 7.5 Ton)",
    "systemType": "vrf",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 7.5,
    "totalCapacityBtuPerHour": 76500,
    "sensibleCapacityBtuPerHour": 58000,
    "heatingCapacityBtuPerHour": 85680,
    "nominalCfm": 2500,
    "minCfm": 800,
    "maxCfm": 3200,
    "maxRatedEspInWg": 0.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 800,
          "espInWg": 0.47,
          "powerKw": 1.56,
          "soundDba": 50
        },
        {
          "cfm": 2500,
          "espInWg": 0.38,
          "powerKw": 5.2,
          "soundDba": 56
        },
        {
          "cfm": 3200,
          "espInWg": 0.25,
          "powerKw": 7.28,
          "soundDba": 62
        }
      ]
    },
    "electricalKw": 5.2,
    "efficiency": {
      "seer": 23,
      "eer": 14.2,
      "copCooling": 4.15,
      "iplv": 25,
      "ratingStandard": "AHRI 1230",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 56,
    "dimensionsIn": {
      "width": 49,
      "depth": 30.1,
      "height": 66.1
    },
    "connectionSizes": {
      "liquidLine": "1/2\"",
      "gasLine": "1-1/8\""
    },
    "costIndex": 88,
    "provenance": {
      "source": "Toshiba VRF Air Conditioning Catalogue (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-toshiba-vrf-10hp",
    "manufacturer": "Toshiba",
    "model": "SMMS-e MMY-MAP1006HT8P (10 HP / 9.5 Ton)",
    "systemType": "vrf",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 9.5,
    "totalCapacityBtuPerHour": 96000,
    "sensibleCapacityBtuPerHour": 74000,
    "heatingCapacityBtuPerHour": 107520,
    "nominalCfm": 3200,
    "minCfm": 1000,
    "maxCfm": 4200,
    "maxRatedEspInWg": 0.55,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 1000,
          "espInWg": 0.52,
          "powerKw": 2.04,
          "soundDba": 52
        },
        {
          "cfm": 3200,
          "espInWg": 0.41,
          "powerKw": 6.8,
          "soundDba": 58
        },
        {
          "cfm": 4200,
          "espInWg": 0.28,
          "powerKw": 9.52,
          "soundDba": 64
        }
      ]
    },
    "electricalKw": 6.8,
    "efficiency": {
      "seer": 23,
      "eer": 14.2,
      "copCooling": 4.15,
      "iplv": 25,
      "ratingStandard": "AHRI 1230",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 58,
    "dimensionsIn": {
      "width": 49,
      "depth": 30.1,
      "height": 66.1
    },
    "connectionSizes": {
      "liquidLine": "1/2\"",
      "gasLine": "1-1/8\""
    },
    "costIndex": 92,
    "provenance": {
      "source": "Toshiba VRF Air Conditioning Catalogue (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-toshiba-vrf-14hp",
    "manufacturer": "Toshiba",
    "model": "SMMS-e MMY-MAP1406HT8P (14 HP / 13.5 Ton)",
    "systemType": "vrf",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 13.5,
    "totalCapacityBtuPerHour": 136500,
    "sensibleCapacityBtuPerHour": 105000,
    "heatingCapacityBtuPerHour": 152880,
    "nominalCfm": 4500,
    "minCfm": 1400,
    "maxCfm": 5800,
    "maxRatedEspInWg": 0.6,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 1400,
          "espInWg": 0.57,
          "powerKw": 2.94,
          "soundDba": 54
        },
        {
          "cfm": 4500,
          "espInWg": 0.45,
          "powerKw": 9.8,
          "soundDba": 60
        },
        {
          "cfm": 5800,
          "espInWg": 0.3,
          "powerKw": 13.72,
          "soundDba": 66
        }
      ]
    },
    "electricalKw": 9.8,
    "efficiency": {
      "seer": 23,
      "eer": 14.2,
      "copCooling": 4.15,
      "iplv": 25,
      "ratingStandard": "AHRI 1230",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 60,
    "dimensionsIn": {
      "width": 49,
      "depth": 30.1,
      "height": 66.1
    },
    "connectionSizes": {
      "liquidLine": "1/2\"",
      "gasLine": "1-1/8\""
    },
    "costIndex": 95,
    "provenance": {
      "source": "Toshiba VRF Air Conditioning Catalogue (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-toshiba-vrf-20hp",
    "manufacturer": "Toshiba",
    "model": "SMMS-e MMY-MAP2006HT8P (20 HP / 19.0 Ton)",
    "systemType": "vrf",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 19,
    "totalCapacityBtuPerHour": 192000,
    "sensibleCapacityBtuPerHour": 148000,
    "heatingCapacityBtuPerHour": 215040,
    "nominalCfm": 6400,
    "minCfm": 2000,
    "maxCfm": 8400,
    "maxRatedEspInWg": 0.65,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 2000,
          "espInWg": 0.62,
          "powerKw": 4.2,
          "soundDba": 56
        },
        {
          "cfm": 6400,
          "espInWg": 0.49,
          "powerKw": 14,
          "soundDba": 62
        },
        {
          "cfm": 8400,
          "espInWg": 0.33,
          "powerKw": 19.6,
          "soundDba": 68
        }
      ]
    },
    "electricalKw": 14,
    "efficiency": {
      "seer": 23,
      "eer": 14.2,
      "copCooling": 4.15,
      "iplv": 25,
      "ratingStandard": "AHRI 1230",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 62,
    "dimensionsIn": {
      "width": 49,
      "depth": 30.1,
      "height": 66.1
    },
    "connectionSizes": {
      "liquidLine": "1/2\"",
      "gasLine": "1-1/8\""
    },
    "costIndex": 98,
    "provenance": {
      "source": "Toshiba VRF Air Conditioning Catalogue (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-toshiba-vrf-30hp",
    "manufacturer": "Toshiba",
    "model": "SMMS-e MMY-MAP3006HT8P (30 HP / 28.5 Ton)",
    "systemType": "vrf",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 28.5,
    "totalCapacityBtuPerHour": 288000,
    "sensibleCapacityBtuPerHour": 220000,
    "heatingCapacityBtuPerHour": 322560,
    "nominalCfm": 9600,
    "minCfm": 3000,
    "maxCfm": 12500,
    "maxRatedEspInWg": 0.7,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 3000,
          "espInWg": 0.66,
          "powerKw": 6.3,
          "soundDba": 59
        },
        {
          "cfm": 9600,
          "espInWg": 0.52,
          "powerKw": 21,
          "soundDba": 65
        },
        {
          "cfm": 12500,
          "espInWg": 0.35,
          "powerKw": 29.4,
          "soundDba": 71
        }
      ]
    },
    "electricalKw": 21,
    "efficiency": {
      "seer": 23,
      "eer": 14.2,
      "copCooling": 4.15,
      "iplv": 25,
      "ratingStandard": "AHRI 1230",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 65,
    "dimensionsIn": {
      "width": 49,
      "depth": 30.1,
      "height": 66.1
    },
    "connectionSizes": {
      "liquidLine": "1/2\"",
      "gasLine": "1-1/8\""
    },
    "costIndex": 105,
    "provenance": {
      "source": "Toshiba VRF Air Conditioning Catalogue (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-toshiba-vrf-40hp",
    "manufacturer": "Toshiba",
    "model": "SMMS-e MMY-MAP4006HT8P (40 HP / 38.0 Ton)",
    "systemType": "vrf",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 38,
    "totalCapacityBtuPerHour": 384000,
    "sensibleCapacityBtuPerHour": 295000,
    "heatingCapacityBtuPerHour": 430080,
    "nominalCfm": 12800,
    "minCfm": 4000,
    "maxCfm": 16500,
    "maxRatedEspInWg": 0.7,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 4000,
          "espInWg": 0.66,
          "powerKw": 8.4,
          "soundDba": 61
        },
        {
          "cfm": 12800,
          "espInWg": 0.52,
          "powerKw": 28,
          "soundDba": 67
        },
        {
          "cfm": 16500,
          "espInWg": 0.35,
          "powerKw": 39.2,
          "soundDba": 73
        }
      ]
    },
    "electricalKw": 28,
    "efficiency": {
      "seer": 23,
      "eer": 14.2,
      "copCooling": 4.15,
      "iplv": 25,
      "ratingStandard": "AHRI 1230",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 67,
    "dimensionsIn": {
      "width": 49,
      "depth": 30.1,
      "height": 66.1
    },
    "connectionSizes": {
      "liquidLine": "1/2\"",
      "gasLine": "1-1/8\""
    },
    "costIndex": 112,
    "provenance": {
      "source": "Toshiba VRF Air Conditioning Catalogue (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-toshiba-vrf-60hp",
    "manufacturer": "Toshiba",
    "model": "SMMS-e MMY-MAP6006HT8P (60 HP / 57.0 Ton)",
    "systemType": "vrf",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": true,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 57,
    "totalCapacityBtuPerHour": 576000,
    "sensibleCapacityBtuPerHour": 440000,
    "heatingCapacityBtuPerHour": 645120,
    "nominalCfm": 19200,
    "minCfm": 6000,
    "maxCfm": 24500,
    "maxRatedEspInWg": 0.75,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 6000,
          "espInWg": 0.71,
          "powerKw": 12.6,
          "soundDba": 64
        },
        {
          "cfm": 19200,
          "espInWg": 0.56,
          "powerKw": 42,
          "soundDba": 70
        },
        {
          "cfm": 24500,
          "espInWg": 0.38,
          "powerKw": 58.8,
          "soundDba": 76
        }
      ]
    },
    "electricalKw": 42,
    "efficiency": {
      "seer": 23,
      "eer": 14.2,
      "copCooling": 4.15,
      "iplv": 25,
      "ratingStandard": "AHRI 1230",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 70,
    "dimensionsIn": {
      "width": 49,
      "depth": 30.1,
      "height": 66.1
    },
    "connectionSizes": {
      "liquidLine": "1/2\"",
      "gasLine": "1-1/8\""
    },
    "costIndex": 120,
    "provenance": {
      "source": "Toshiba VRF Air Conditioning Catalogue (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-lg-round-cass-24k",
    "manufacturer": "LG",
    "model": "LG 360 Round Cassette 24K (2.0 Ton)",
    "systemType": "cassette",
    "capabilities": {
      "supportsDuctNetwork": false,
      "supportsExternalDiffusers": false,
      "supportsReturnDuct": false,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": false
    },
    "nominalTons": 2,
    "totalCapacityBtuPerHour": 24000,
    "sensibleCapacityBtuPerHour": 18400,
    "heatingCapacityBtuPerHour": 26400,
    "nominalCfm": 750,
    "minCfm": 525,
    "maxCfm": 900,
    "maxRatedEspInWg": 0,
    "fanPerformance": {
      "type": "multi-speed",
      "allowExtrapolation": false,
      "speeds": {
        "Low": [
          {
            "cfm": 525,
            "espInWg": 0,
            "soundDba": 30
          }
        ],
        "Medium": [
          {
            "cfm": 638,
            "espInWg": 0,
            "soundDba": 33
          }
        ],
        "High": [
          {
            "cfm": 750,
            "espInWg": 0,
            "soundDba": 36
          }
        ]
      }
    },
    "electricalKw": 1.8,
    "efficiency": {
      "seer": 18.5,
      "eer": 13,
      "copCooling": 3.8,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 36,
    "dimensionsIn": {
      "width": 41.3,
      "depth": 41.3,
      "height": 13
    },
    "connectionSizes": {
      "liquidLine": "3/8\"",
      "gasLine": "5/8\""
    },
    "costIndex": 58,
    "provenance": {
      "source": "LG Round Cassette Product Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-lg-round-cass-36k",
    "manufacturer": "LG",
    "model": "LG 360 Round Cassette 36K (3.0 Ton)",
    "systemType": "cassette",
    "capabilities": {
      "supportsDuctNetwork": false,
      "supportsExternalDiffusers": false,
      "supportsReturnDuct": false,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": false
    },
    "nominalTons": 3,
    "totalCapacityBtuPerHour": 36000,
    "sensibleCapacityBtuPerHour": 27500,
    "heatingCapacityBtuPerHour": 39600,
    "nominalCfm": 1100,
    "minCfm": 770,
    "maxCfm": 1320,
    "maxRatedEspInWg": 0,
    "fanPerformance": {
      "type": "multi-speed",
      "allowExtrapolation": false,
      "speeds": {
        "Low": [
          {
            "cfm": 770,
            "espInWg": 0,
            "soundDba": 34
          }
        ],
        "Medium": [
          {
            "cfm": 935,
            "espInWg": 0,
            "soundDba": 37
          }
        ],
        "High": [
          {
            "cfm": 1100,
            "espInWg": 0,
            "soundDba": 40
          }
        ]
      }
    },
    "electricalKw": 2.7,
    "efficiency": {
      "seer": 18.5,
      "eer": 13,
      "copCooling": 3.8,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 40,
    "dimensionsIn": {
      "width": 41.3,
      "depth": 41.3,
      "height": 13
    },
    "connectionSizes": {
      "liquidLine": "3/8\"",
      "gasLine": "5/8\""
    },
    "costIndex": 68,
    "provenance": {
      "source": "LG Round Cassette Product Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-lg-round-cass-48k",
    "manufacturer": "LG",
    "model": "LG 360 Round Cassette 48K (4.0 Ton)",
    "systemType": "cassette",
    "capabilities": {
      "supportsDuctNetwork": false,
      "supportsExternalDiffusers": false,
      "supportsReturnDuct": false,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": false
    },
    "nominalTons": 4,
    "totalCapacityBtuPerHour": 48000,
    "sensibleCapacityBtuPerHour": 36500,
    "heatingCapacityBtuPerHour": 52800,
    "nominalCfm": 1350,
    "minCfm": 945,
    "maxCfm": 1620,
    "maxRatedEspInWg": 0,
    "fanPerformance": {
      "type": "multi-speed",
      "allowExtrapolation": false,
      "speeds": {
        "Low": [
          {
            "cfm": 945,
            "espInWg": 0,
            "soundDba": 38
          }
        ],
        "Medium": [
          {
            "cfm": 1148,
            "espInWg": 0,
            "soundDba": 41
          }
        ],
        "High": [
          {
            "cfm": 1350,
            "espInWg": 0,
            "soundDba": 44
          }
        ]
      }
    },
    "electricalKw": 3.6,
    "efficiency": {
      "seer": 18.5,
      "eer": 13,
      "copCooling": 3.8,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 44,
    "dimensionsIn": {
      "width": 41.3,
      "depth": 41.3,
      "height": 13
    },
    "connectionSizes": {
      "liquidLine": "3/8\"",
      "gasLine": "5/8\""
    },
    "costIndex": 78,
    "provenance": {
      "source": "LG Round Cassette Product Guide (Lecture 06)",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-ducted-90k",
    "manufacturer": "Carrier",
    "model": "42QSS090-D (7.5 Ton)",
    "systemType": "concealed",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 7.5,
    "totalCapacityBtuPerHour": 90000,
    "sensibleCapacityBtuPerHour": 70000,
    "heatingCapacityBtuPerHour": 98000,
    "nominalCfm": 2800,
    "minCfm": 2200,
    "maxCfm": 3400,
    "maxRatedEspInWg": 0.8,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 2200,
          "espInWg": 0.78,
          "powerKw": 0.85,
          "soundDba": 52
        },
        {
          "cfm": 2800,
          "espInWg": 0.65,
          "powerKw": 1.15,
          "soundDba": 56
        },
        {
          "cfm": 3400,
          "espInWg": 0.45,
          "powerKw": 1.45,
          "soundDba": 61
        }
      ]
    },
    "electricalKw": 6.8,
    "efficiency": {
      "seer": 15.2,
      "eer": 11.5,
      "copCooling": 3.35,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 56,
    "dimensionsIn": {
      "width": 68,
      "depth": 36,
      "height": 16
    },
    "connectionSizes": {
      "supplyDuct": "58\"x14\"",
      "returnDuct": "62\"x14\"",
      "liquidLine": "1/2\"",
      "gasLine": "1-1/8\""
    },
    "costIndex": 92,
    "provenance": {
      "source": "Carrier Ducted Product Guide",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-ducted-120k",
    "manufacturer": "Carrier",
    "model": "42QSS120-D (10 Ton)",
    "systemType": "concealed",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 10,
    "totalCapacityBtuPerHour": 120000,
    "sensibleCapacityBtuPerHour": 92000,
    "heatingCapacityBtuPerHour": 130000,
    "nominalCfm": 3800,
    "minCfm": 2800,
    "maxCfm": 4600,
    "maxRatedEspInWg": 0.8,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 2800,
          "espInWg": 0.78,
          "powerKw": 1.1,
          "soundDba": 55
        },
        {
          "cfm": 3800,
          "espInWg": 0.62,
          "powerKw": 1.5,
          "soundDba": 59
        },
        {
          "cfm": 4600,
          "espInWg": 0.4,
          "powerKw": 1.9,
          "soundDba": 64
        }
      ]
    },
    "electricalKw": 9.2,
    "efficiency": {
      "seer": 15,
      "eer": 11.2,
      "copCooling": 3.28,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 59,
    "dimensionsIn": {
      "width": 74,
      "depth": 38,
      "height": 18
    },
    "connectionSizes": {
      "supplyDuct": "64\"x16\"",
      "returnDuct": "68\"x16\"",
      "liquidLine": "1/2\"",
      "gasLine": "1-1/8\""
    },
    "costIndex": 96,
    "provenance": {
      "source": "Carrier Ducted Product Guide",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-hw-12k",
    "manufacturer": "Carrier",
    "model": "Optimax 12K",
    "systemType": "high-wall",
    "capabilities": {
      "supportsDuctNetwork": false,
      "supportsExternalDiffusers": false,
      "supportsReturnDuct": false,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": false
    },
    "nominalTons": 1,
    "totalCapacityBtuPerHour": 12050,
    "sensibleCapacityBtuPerHour": 9200,
    "heatingCapacityBtuPerHour": 13000,
    "nominalCfm": 326,
    "minCfm": 220,
    "maxCfm": 380,
    "maxRatedEspInWg": 0,
    "fanPerformance": {
      "type": "multi-speed",
      "allowExtrapolation": false,
      "speeds": {
        "Low": [
          {
            "cfm": 220,
            "espInWg": 0,
            "soundDba": 28
          }
        ],
        "Medium": [
          {
            "cfm": 280,
            "espInWg": 0,
            "soundDba": 34
          }
        ],
        "High": [
          {
            "cfm": 326,
            "espInWg": 0,
            "soundDba": 39
          }
        ]
      }
    },
    "electricalKw": 1.05,
    "efficiency": {
      "seer": 18,
      "eer": 12.8,
      "copCooling": 3.75,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 34,
    "dimensionsIn": {
      "width": 31.5,
      "depth": 8.5,
      "height": 11.4
    },
    "connectionSizes": {
      "liquidLine": "1/4\"",
      "gasLine": "3/8\""
    },
    "costIndex": 25,
    "provenance": {
      "source": "Carrier Decorative Product Guide",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-hw-24k",
    "manufacturer": "Carrier",
    "model": "Optimax 24K",
    "systemType": "high-wall",
    "capabilities": {
      "supportsDuctNetwork": false,
      "supportsExternalDiffusers": false,
      "supportsReturnDuct": false,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": false
    },
    "nominalTons": 2,
    "totalCapacityBtuPerHour": 22800,
    "sensibleCapacityBtuPerHour": 17200,
    "heatingCapacityBtuPerHour": 24000,
    "nominalCfm": 633,
    "minCfm": 450,
    "maxCfm": 720,
    "maxRatedEspInWg": 0,
    "fanPerformance": {
      "type": "multi-speed",
      "allowExtrapolation": false,
      "speeds": {
        "Low": [
          {
            "cfm": 450,
            "espInWg": 0,
            "soundDba": 35
          }
        ],
        "Medium": [
          {
            "cfm": 540,
            "espInWg": 0,
            "soundDba": 40
          }
        ],
        "High": [
          {
            "cfm": 633,
            "espInWg": 0,
            "soundDba": 46
          }
        ]
      }
    },
    "electricalKw": 1.95,
    "efficiency": {
      "seer": 17,
      "eer": 12.2,
      "copCooling": 3.58,
      "ratingStandard": "AHRI 210/240",
      "ratingConditions": "95°F Outdoor / 80°F DB 67°F WB Indoor"
    },
    "soundDba": 40,
    "dimensionsIn": {
      "width": 42.5,
      "depth": 9.6,
      "height": 13.2
    },
    "connectionSizes": {
      "liquidLine": "3/8\"",
      "gasLine": "5/8\""
    },
    "costIndex": 38,
    "provenance": {
      "source": "Carrier Decorative Product Guide",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-fcu-1t",
    "manufacturer": "Carrier",
    "model": "42CE-04 (1 Ton FCU)",
    "systemType": "fcu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 1,
    "totalCapacityBtuPerHour": 12000,
    "sensibleCapacityBtuPerHour": 9200,
    "heatingCapacityBtuPerHour": 13500,
    "nominalCfm": 400,
    "minCfm": 280,
    "maxCfm": 480,
    "maxRatedEspInWg": 0.3,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 280,
          "espInWg": 0.28,
          "powerKw": 0.08,
          "soundDba": 34
        },
        {
          "cfm": 400,
          "espInWg": 0.22,
          "powerKw": 0.12,
          "soundDba": 38
        },
        {
          "cfm": 480,
          "espInWg": 0.12,
          "powerKw": 0.16,
          "soundDba": 42
        }
      ]
    },
    "electricalKw": 0.95,
    "efficiency": {
      "copCooling": 3.85,
      "eer": 12.5,
      "ratingStandard": "AHRI 440",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 38,
    "dimensionsIn": {
      "width": 32,
      "depth": 22,
      "height": 9.5
    },
    "connectionSizes": {
      "supplyDuct": "24\"x8\"",
      "returnDuct": "26\"x8\""
    },
    "costIndex": 35,
    "provenance": {
      "source": "Carrier Fan Coil Catalog",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-fcu-2t",
    "manufacturer": "Carrier",
    "model": "42CE-08 (2 Ton FCU)",
    "systemType": "fcu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 2,
    "totalCapacityBtuPerHour": 24000,
    "sensibleCapacityBtuPerHour": 18400,
    "heatingCapacityBtuPerHour": 26500,
    "nominalCfm": 800,
    "minCfm": 580,
    "maxCfm": 950,
    "maxRatedEspInWg": 0.4,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 580,
          "espInWg": 0.38,
          "powerKw": 0.14,
          "soundDba": 37
        },
        {
          "cfm": 800,
          "espInWg": 0.3,
          "powerKw": 0.2,
          "soundDba": 42
        },
        {
          "cfm": 950,
          "espInWg": 0.18,
          "powerKw": 0.28,
          "soundDba": 46
        }
      ]
    },
    "electricalKw": 1.85,
    "efficiency": {
      "copCooling": 3.8,
      "eer": 12.2,
      "ratingStandard": "AHRI 440",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 42,
    "dimensionsIn": {
      "width": 42,
      "depth": 24,
      "height": 10.5
    },
    "connectionSizes": {
      "supplyDuct": "32\"x8\"",
      "returnDuct": "36\"x8\""
    },
    "costIndex": 45,
    "provenance": {
      "source": "Carrier Fan Coil Catalog",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-fcu-3t",
    "manufacturer": "Carrier",
    "model": "42CE-12 (3 Ton FCU)",
    "systemType": "fcu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 3,
    "totalCapacityBtuPerHour": 36000,
    "sensibleCapacityBtuPerHour": 27500,
    "heatingCapacityBtuPerHour": 39000,
    "nominalCfm": 1200,
    "minCfm": 880,
    "maxCfm": 1400,
    "maxRatedEspInWg": 0.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 880,
          "espInWg": 0.48,
          "powerKw": 0.22,
          "soundDba": 40
        },
        {
          "cfm": 1200,
          "espInWg": 0.38,
          "powerKw": 0.32,
          "soundDba": 45
        },
        {
          "cfm": 1400,
          "espInWg": 0.22,
          "powerKw": 0.42,
          "soundDba": 49
        }
      ]
    },
    "electricalKw": 2.75,
    "efficiency": {
      "copCooling": 3.75,
      "eer": 12,
      "ratingStandard": "AHRI 440",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 45,
    "dimensionsIn": {
      "width": 52,
      "depth": 26,
      "height": 11.5
    },
    "connectionSizes": {
      "supplyDuct": "42\"x10\"",
      "returnDuct": "46\"x10\""
    },
    "costIndex": 58,
    "provenance": {
      "source": "Carrier Fan Coil Catalog",
      "version": "2024.1",
      "isUserImported": false
    }
  },
  {
    "id": "eq-fcu-4t",
    "manufacturer": "Carrier",
    "model": "42CE-16 (4 Ton FCU)",
    "systemType": "fcu",
    "capabilities": {
      "supportsDuctNetwork": true,
      "supportsExternalDiffusers": true,
      "supportsReturnDuct": true,
      "supportsMultipleZones": false,
      "requiresIndoorUnitSelection": true,
      "hasExternalStaticPressure": true
    },
    "nominalTons": 4,
    "totalCapacityBtuPerHour": 48000,
    "sensibleCapacityBtuPerHour": 36500,
    "heatingCapacityBtuPerHour": 52000,
    "nominalCfm": 1600,
    "minCfm": 1200,
    "maxCfm": 1850,
    "maxRatedEspInWg": 0.5,
    "fanPerformance": {
      "type": "tabular",
      "allowExtrapolation": false,
      "table": [
        {
          "cfm": 1200,
          "espInWg": 0.48,
          "powerKw": 0.3,
          "soundDba": 42
        },
        {
          "cfm": 1600,
          "espInWg": 0.36,
          "powerKw": 0.44,
          "soundDba": 47
        },
        {
          "cfm": 1850,
          "espInWg": 0.2,
          "powerKw": 0.55,
          "soundDba": 52
        }
      ]
    },
    "electricalKw": 3.65,
    "efficiency": {
      "copCooling": 3.7,
      "eer": 11.8,
      "ratingStandard": "AHRI 440",
      "ratingConditions": "Chilled water 44°F / 54°F"
    },
    "soundDba": 47,
    "dimensionsIn": {
      "width": 62,
      "depth": 28,
      "height": 12.5
    },
    "connectionSizes": {
      "supplyDuct": "50\"x10\"",
      "returnDuct": "54\"x10\""
    },
    "costIndex": 68,
    "provenance": {
      "source": "Carrier Fan Coil Catalog",
      "version": "2024.1",
      "isUserImported": false
    }
  }
];

/**
 * Standard Diffuser & Terminal Catalog with Performance Tables
 */
export const STANDARD_DIFFUSER_CATALOG: DiffuserCatalogItem[] = [
  {
    id: 'dif-sq-9x9',
    manufacturer: 'Titus',
    model: 'TMS 9"x9" (6" Neck)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 6, height: 6, diameter: 6 },
    faceSizeIn: { width: 9, height: 9 },
    minCfm: 75,
    maxCfm: 250,
    performanceTable: [
      { cfm: 100, deltaPInWg: 0.015, ncRating: 15, throwFt: { t50: 6, t100: 4, t150: 2.5 } },
      { cfm: 150, deltaPInWg: 0.032, ncRating: 22, throwFt: { t50: 9, t100: 6, t150: 4 } },
      { cfm: 200, deltaPInWg: 0.058, ncRating: 29, throwFt: { t50: 12, t100: 8.5, t150: 5.5 } },
      { cfm: 250, deltaPInWg: 0.09, ncRating: 36, throwFt: { t50: 15, t100: 10.5, t150: 7 } }
    ],
    costIndex: 30,
    provenance: { source: 'Titus Ceiling Diffuser Catalog', version: '2024.1' }
  },
  {
    id: 'dif-sq-12x12',
    manufacturer: 'Titus',
    model: 'TMS 12"x12" (8" Neck)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 8, height: 8, diameter: 8 },
    faceSizeIn: { width: 12, height: 12 },
    minCfm: 150,
    maxCfm: 450,
    performanceTable: [
      { cfm: 200, deltaPInWg: 0.022, ncRating: 18, throwFt: { t50: 9.5, t100: 6.5, t150: 4.5 } },
      { cfm: 300, deltaPInWg: 0.048, ncRating: 26, throwFt: { t50: 14, t100: 9.5, t150: 6.5 } },
      { cfm: 400, deltaPInWg: 0.082, ncRating: 33, throwFt: { t50: 18, t100: 12.5, t150: 8.5 } },
      { cfm: 450, deltaPInWg: 0.105, ncRating: 38, throwFt: { t50: 20.5, t100: 14, t150: 9.5 } }
    ],
    costIndex: 40,
    provenance: { source: 'Titus Ceiling Diffuser Catalog', version: '2024.1' }
  },
  {
    id: 'dif-sq-15x15',
    manufacturer: 'Titus',
    model: 'TMS 15"x15" (10" Neck)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 10, height: 10, diameter: 10 },
    faceSizeIn: { width: 15, height: 15 },
    minCfm: 250,
    maxCfm: 650,
    performanceTable: [
      { cfm: 300, deltaPInWg: 0.025, ncRating: 20, throwFt: { t50: 12, t100: 8, t150: 5.5 } },
      { cfm: 450, deltaPInWg: 0.052, ncRating: 28, throwFt: { t50: 17.5, t100: 12, t150: 8 } },
      { cfm: 600, deltaPInWg: 0.092, ncRating: 35, throwFt: { t50: 23, t100: 16, t150: 11 } }
    ],
    costIndex: 50,
    provenance: { source: 'Titus Ceiling Diffuser Catalog', version: '2024.1' }
  },
  {
    id: 'dif-sq-18x18',
    manufacturer: 'Titus',
    model: 'TMS 18"x18" (12" Neck)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 12, height: 12, diameter: 12 },
    faceSizeIn: { width: 18, height: 18 },
    minCfm: 400,
    maxCfm: 900,
    performanceTable: [
      { cfm: 450, deltaPInWg: 0.028, ncRating: 22, throwFt: { t50: 15, t100: 10, t150: 7 } },
      { cfm: 650, deltaPInWg: 0.058, ncRating: 30, throwFt: { t50: 21, t100: 14.5, t150: 10 } },
      { cfm: 850, deltaPInWg: 0.098, ncRating: 38, throwFt: { t50: 27, t100: 18.5, t150: 13 } }
    ],
    costIndex: 65,
    provenance: { source: 'Titus Ceiling Diffuser Catalog', version: '2024.1' }
  },
  {
    id: 'dif-linear-2slot',
    manufacturer: 'Price',
    model: 'Linear Slot 2-Slot 48"',
    terminalType: 'linear-slot',
    neckSizeIn: { width: 48, height: 3 },
    faceSizeIn: { width: 48, height: 4.5 },
    minCfm: 100,
    maxCfm: 400,
    performanceTable: [
      { cfm: 150, deltaPInWg: 0.03, ncRating: 18, throwFt: { t50: 11, t100: 7.5, t150: 5 } },
      { cfm: 250, deltaPInWg: 0.075, ncRating: 27, throwFt: { t50: 18, t100: 12, t150: 8 } },
      { cfm: 350, deltaPInWg: 0.14, ncRating: 36, throwFt: { t50: 24, t100: 16.5, t150: 11.5 } }
    ],
    costIndex: 75,
    provenance: { source: 'Price Industries Linear Catalog', version: '2024.1' }
  },
  {
    id: 'grille-return-eggcrate',
    manufacturer: 'Titus',
    model: '50F Eggcrate Return 24"x24"',
    terminalType: 'return-grille',
    neckSizeIn: { width: 24, height: 24 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 300,
    maxCfm: 1500,
    performanceTable: [
      { cfm: 500, deltaPInWg: 0.01, ncRating: 14, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 1000, deltaPInWg: 0.035, ncRating: 24, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 1500, deltaPInWg: 0.08, ncRating: 34, throwFt: { t50: 0, t100: 0, t150: 0 } }
    ],
    costIndex: 45,
    provenance: { source: 'Titus Grilles & Registers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4scd-6x6',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-SCD 4-Way Square Diffuser 6"x6"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 6, height: 6 },
    faceSizeIn: { width: 12, height: 12 },
    minCfm: 50,
    maxCfm: 225,
    performanceTable: [
      { cfm: 50, deltaPInWg: 0.019, ncRating: 15, throwFt: { t50: 3, t100: 2, t150: 1 } },
      { cfm: 75, deltaPInWg: 0.039, ncRating: 18, throwFt: { t50: 5, t100: 3, t150: 2 } },
      { cfm: 100, deltaPInWg: 0.067, ncRating: 22, throwFt: { t50: 7, t100: 4, t150: 3 } },
      { cfm: 125, deltaPInWg: 0.1, ncRating: 26, throwFt: { t50: 9, t100: 5, t150: 3.5 } },
      { cfm: 150, deltaPInWg: 0.14, ncRating: 30, throwFt: { t50: 11, t100: 6, t150: 4 } },
      { cfm: 175, deltaPInWg: 0.19, ncRating: 34, throwFt: { t50: 13, t100: 7, t150: 4.5 } },
      { cfm: 200, deltaPInWg: 0.24, ncRating: 38, throwFt: { t50: 15, t100: 8, t150: 5 } },
      { cfm: 225, deltaPInWg: 0.3, ncRating: 41, throwFt: { t50: 17, t100: 9, t150: 6 } }
    ],
    costIndex: 30,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4scd-9x9',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-SCD 4-Way Square Diffuser 9"x9"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 9, height: 9 },
    faceSizeIn: { width: 15, height: 15 },
    minCfm: 112,
    maxCfm: 504,
    performanceTable: [
      { cfm: 112, deltaPInWg: 0.019, ncRating: 15, throwFt: { t50: 3, t100: 2, t150: 1 } },
      { cfm: 168, deltaPInWg: 0.039, ncRating: 19, throwFt: { t50: 5, t100: 3, t150: 2 } },
      { cfm: 224, deltaPInWg: 0.067, ncRating: 23, throwFt: { t50: 8, t100: 4, t150: 3 } },
      { cfm: 280, deltaPInWg: 0.1, ncRating: 27, throwFt: { t50: 10, t100: 5, t150: 3.5 } },
      { cfm: 336, deltaPInWg: 0.14, ncRating: 31, throwFt: { t50: 12, t100: 6, t150: 4 } },
      { cfm: 392, deltaPInWg: 0.19, ncRating: 35, throwFt: { t50: 14, t100: 7, t150: 5 } },
      { cfm: 448, deltaPInWg: 0.24, ncRating: 39, throwFt: { t50: 17, t100: 9, t150: 6 } },
      { cfm: 504, deltaPInWg: 0.3, ncRating: 42, throwFt: { t50: 18, t100: 9, t150: 6.5 } }
    ],
    costIndex: 38,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4scd-12x12',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-SCD 4-Way Square Diffuser 12"x12"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 12, height: 12 },
    faceSizeIn: { width: 18, height: 18 },
    minCfm: 200,
    maxCfm: 900,
    performanceTable: [
      { cfm: 200, deltaPInWg: 0.019, ncRating: 16, throwFt: { t50: 4, t100: 2, t150: 1.5 } },
      { cfm: 300, deltaPInWg: 0.039, ncRating: 20, throwFt: { t50: 7, t100: 4, t150: 2.5 } },
      { cfm: 400, deltaPInWg: 0.067, ncRating: 25, throwFt: { t50: 9, t100: 5, t150: 3.5 } },
      { cfm: 500, deltaPInWg: 0.1, ncRating: 29, throwFt: { t50: 11, t100: 6, t150: 4.5 } },
      { cfm: 600, deltaPInWg: 0.14, ncRating: 33, throwFt: { t50: 14, t100: 7, t150: 5 } },
      { cfm: 700, deltaPInWg: 0.19, ncRating: 37, throwFt: { t50: 16, t100: 8, t150: 6 } },
      { cfm: 800, deltaPInWg: 0.24, ncRating: 40, throwFt: { t50: 19, t100: 10, t150: 7 } },
      { cfm: 900, deltaPInWg: 0.3, ncRating: 44, throwFt: { t50: 21, t100: 11, t150: 8 } }
    ],
    costIndex: 48,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4scd-15x15',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-SCD 4-Way Square Diffuser 15"x15"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 15, height: 15 },
    faceSizeIn: { width: 21, height: 21 },
    minCfm: 312,
    maxCfm: 1404,
    performanceTable: [
      { cfm: 312, deltaPInWg: 0.019, ncRating: 17, throwFt: { t50: 5, t100: 3, t150: 2 } },
      { cfm: 468, deltaPInWg: 0.039, ncRating: 22, throwFt: { t50: 8, t100: 5, t150: 3 } },
      { cfm: 624, deltaPInWg: 0.067, ncRating: 27, throwFt: { t50: 11, t100: 6, t150: 4 } },
      { cfm: 780, deltaPInWg: 0.1, ncRating: 31, throwFt: { t50: 13, t100: 7, t150: 5 } },
      { cfm: 936, deltaPInWg: 0.14, ncRating: 35, throwFt: { t50: 16, t100: 8, t150: 6 } },
      { cfm: 1092, deltaPInWg: 0.19, ncRating: 39, throwFt: { t50: 19, t100: 10, t150: 7 } },
      { cfm: 1248, deltaPInWg: 0.24, ncRating: 42, throwFt: { t50: 21, t100: 11, t150: 8 } },
      { cfm: 1404, deltaPInWg: 0.3, ncRating: 45, throwFt: { t50: 24, t100: 12, t150: 9 } }
    ],
    costIndex: 60,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4scd-18x18',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-SCD 4-Way Square Diffuser 18"x18"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 18, height: 18 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 450,
    maxCfm: 2025,
    performanceTable: [
      { cfm: 450, deltaPInWg: 0.019, ncRating: 18, throwFt: { t50: 6, t100: 3.5, t150: 2.5 } },
      { cfm: 675, deltaPInWg: 0.039, ncRating: 24, throwFt: { t50: 9, t100: 5.5, t150: 3.5 } },
      { cfm: 900, deltaPInWg: 0.067, ncRating: 29, throwFt: { t50: 13, t100: 7.5, t150: 5 } },
      { cfm: 1125, deltaPInWg: 0.1, ncRating: 33, throwFt: { t50: 16, t100: 9, t150: 6 } },
      { cfm: 1350, deltaPInWg: 0.14, ncRating: 37, throwFt: { t50: 19, t100: 10.5, t150: 7 } },
      { cfm: 1575, deltaPInWg: 0.19, ncRating: 41, throwFt: { t50: 22, t100: 12, t150: 8.5 } },
      { cfm: 1800, deltaPInWg: 0.24, ncRating: 44, throwFt: { t50: 25, t100: 13.5, t150: 9.5 } },
      { cfm: 2025, deltaPInWg: 0.3, ncRating: 47, throwFt: { t50: 28, t100: 15, t150: 11 } }
    ],
    costIndex: 75,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4scd-21x21',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-SCD 4-Way Square Diffuser 21"x21"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 21, height: 21 },
    faceSizeIn: { width: 27, height: 27 },
    minCfm: 612,
    maxCfm: 2754,
    performanceTable: [
      { cfm: 612, deltaPInWg: 0.019, ncRating: 20, throwFt: { t50: 7, t100: 4, t150: 3 } },
      { cfm: 918, deltaPInWg: 0.039, ncRating: 26, throwFt: { t50: 11, t100: 6.5, t150: 4.5 } },
      { cfm: 1224, deltaPInWg: 0.067, ncRating: 31, throwFt: { t50: 15, t100: 8.5, t150: 6 } },
      { cfm: 1530, deltaPInWg: 0.1, ncRating: 35, throwFt: { t50: 19, t100: 10.5, t150: 7.5 } },
      { cfm: 1836, deltaPInWg: 0.14, ncRating: 39, throwFt: { t50: 22, t100: 12.5, t150: 8.5 } },
      { cfm: 2142, deltaPInWg: 0.19, ncRating: 43, throwFt: { t50: 26, t100: 14.5, t150: 10 } },
      { cfm: 2448, deltaPInWg: 0.24, ncRating: 46, throwFt: { t50: 29, t100: 16, t150: 11.5 } },
      { cfm: 2754, deltaPInWg: 0.3, ncRating: 49, throwFt: { t50: 33, t100: 18, t150: 13 } }
    ],
    costIndex: 90,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4scd-24x24',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-SCD 4-Way Square Diffuser 24"x24"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 24, height: 24 },
    faceSizeIn: { width: 30, height: 30 },
    minCfm: 800,
    maxCfm: 3600,
    performanceTable: [
      { cfm: 800, deltaPInWg: 0.019, ncRating: 22, throwFt: { t50: 8, t100: 4.5, t150: 3.5 } },
      { cfm: 1200, deltaPInWg: 0.039, ncRating: 28, throwFt: { t50: 13, t100: 7.5, t150: 5 } },
      { cfm: 1600, deltaPInWg: 0.067, ncRating: 33, throwFt: { t50: 17, t100: 9.5, t150: 7 } },
      { cfm: 2000, deltaPInWg: 0.1, ncRating: 37, throwFt: { t50: 21, t100: 12, t150: 8.5 } },
      { cfm: 2400, deltaPInWg: 0.14, ncRating: 41, throwFt: { t50: 25, t100: 14, t150: 10 } },
      { cfm: 2800, deltaPInWg: 0.19, ncRating: 45, throwFt: { t50: 30, t100: 16.5, t150: 12 } },
      { cfm: 3200, deltaPInWg: 0.24, ncRating: 48, throwFt: { t50: 34, t100: 19, t150: 13.5 } },
      { cfm: 3600, deltaPInWg: 0.3, ncRating: 51, throwFt: { t50: 38, t100: 21, t150: 15 } }
    ],
    costIndex: 110,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4rcd-6in',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-RCD Square Face Round Neck Diffuser 6" Neck (24"x24" Face)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 6, height: 6, diameter: 6 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 50,
    maxCfm: 225,
    performanceTable: [
      { cfm: 50, deltaPInWg: 0.015, ncRating: 15, throwFt: { t50: 3.5, t100: 2, t150: 1 } },
      { cfm: 100, deltaPInWg: 0.045, ncRating: 21, throwFt: { t50: 7, t100: 4.5, t150: 2.5 } },
      { cfm: 150, deltaPInWg: 0.095, ncRating: 28, throwFt: { t50: 10.5, t100: 6.5, t150: 4 } },
      { cfm: 225, deltaPInWg: 0.21, ncRating: 37, throwFt: { t50: 15, t100: 9, t150: 6 } }
    ],
    costIndex: 35,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4rcd-8in',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-RCD Square Face Round Neck Diffuser 8" Neck (24"x24" Face)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 8, height: 8, diameter: 8 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 90,
    maxCfm: 400,
    performanceTable: [
      { cfm: 90, deltaPInWg: 0.016, ncRating: 15, throwFt: { t50: 4.5, t100: 3, t150: 1.5 } },
      { cfm: 180, deltaPInWg: 0.048, ncRating: 23, throwFt: { t50: 9, t100: 6, t150: 3.5 } },
      { cfm: 270, deltaPInWg: 0.105, ncRating: 30, throwFt: { t50: 13.5, t100: 8.5, t150: 5.5 } },
      { cfm: 400, deltaPInWg: 0.225, ncRating: 39, throwFt: { t50: 18, t100: 11.5, t150: 7.5 } }
    ],
    costIndex: 42,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4rcd-10in',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-RCD Square Face Round Neck Diffuser 10" Neck (24"x24" Face)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 10, height: 10, diameter: 10 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 140,
    maxCfm: 630,
    performanceTable: [
      { cfm: 140, deltaPInWg: 0.018, ncRating: 16, throwFt: { t50: 6, t100: 3.5, t150: 2 } },
      { cfm: 280, deltaPInWg: 0.052, ncRating: 24, throwFt: { t50: 11.5, t100: 7.5, t150: 4.5 } },
      { cfm: 420, deltaPInWg: 0.115, ncRating: 32, throwFt: { t50: 17, t100: 11, t150: 7 } },
      { cfm: 630, deltaPInWg: 0.245, ncRating: 41, throwFt: { t50: 23, t100: 15, t150: 9.5 } }
    ],
    costIndex: 52,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4rcd-12in',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-RCD Square Face Round Neck Diffuser 12" Neck (24"x24" Face)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 12, height: 12, diameter: 12 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 200,
    maxCfm: 900,
    performanceTable: [
      { cfm: 200, deltaPInWg: 0.02, ncRating: 18, throwFt: { t50: 7.5, t100: 4.5, t150: 3 } },
      { cfm: 400, deltaPInWg: 0.058, ncRating: 26, throwFt: { t50: 14.5, t100: 9.5, t150: 6 } },
      { cfm: 600, deltaPInWg: 0.128, ncRating: 34, throwFt: { t50: 21, t100: 13.5, t150: 8.5 } },
      { cfm: 900, deltaPInWg: 0.27, ncRating: 43, throwFt: { t50: 28, t100: 18, t150: 11.5 } }
    ],
    costIndex: 65,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4rcd-14in',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-RCD Square Face Round Neck Diffuser 14" Neck (24"x24" Face)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 14, height: 14, diameter: 14 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 270,
    maxCfm: 1225,
    performanceTable: [
      { cfm: 270, deltaPInWg: 0.022, ncRating: 20, throwFt: { t50: 9, t100: 5.5, t150: 3.5 } },
      { cfm: 540, deltaPInWg: 0.064, ncRating: 28, throwFt: { t50: 17, t100: 11, t150: 7 } },
      { cfm: 810, deltaPInWg: 0.14, ncRating: 36, throwFt: { t50: 25, t100: 16, t150: 10 } },
      { cfm: 1225, deltaPInWg: 0.295, ncRating: 45, throwFt: { t50: 33, t100: 21.5, t150: 13.5 } }
    ],
    costIndex: 78,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-4rcd-16in',
    manufacturer: 'Al-Andalosia',
    model: 'Model 4-RCD Square Face Round Neck Diffuser 16" Neck (24"x24" Face)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 16, height: 16, diameter: 16 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 350,
    maxCfm: 1600,
    performanceTable: [
      { cfm: 350, deltaPInWg: 0.024, ncRating: 21, throwFt: { t50: 10.5, t100: 6.5, t150: 4 } },
      { cfm: 700, deltaPInWg: 0.07, ncRating: 30, throwFt: { t50: 20, t100: 13, t150: 8 } },
      { cfm: 1050, deltaPInWg: 0.155, ncRating: 38, throwFt: { t50: 29, t100: 18.5, t150: 11.5 } },
      { cfm: 1600, deltaPInWg: 0.32, ncRating: 47, throwFt: { t50: 38, t100: 25, t150: 16 } }
    ],
    costIndex: 92,
    provenance: { source: 'Al-Andalosia Square Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-3scd-12x12',
    manufacturer: 'Al-Andalosia',
    model: 'Model 3-SCD 3-Way Square Diffuser 12"x12"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 12, height: 12 },
    faceSizeIn: { width: 18, height: 18 },
    minCfm: 200,
    maxCfm: 800,
    performanceTable: [
      { cfm: 200, deltaPInWg: 0.022, ncRating: 18, throwFt: { t50: 8, t100: 5, t150: 3 } },
      { cfm: 400, deltaPInWg: 0.075, ncRating: 27, throwFt: { t50: 16, t100: 10, t150: 6 } },
      { cfm: 600, deltaPInWg: 0.155, ncRating: 35, throwFt: { t50: 22, t100: 14.5, t150: 9 } },
      { cfm: 800, deltaPInWg: 0.265, ncRating: 42, throwFt: { t50: 28, t100: 18.5, t150: 12 } }
    ],
    costIndex: 50,
    provenance: { source: 'Al-Andalosia Directional Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-2scd-12x12',
    manufacturer: 'Al-Andalosia',
    model: 'Model 2-SCD 2-Way (Opposite) Square Diffuser 12"x12"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 12, height: 12 },
    faceSizeIn: { width: 18, height: 18 },
    minCfm: 200,
    maxCfm: 800,
    performanceTable: [
      { cfm: 200, deltaPInWg: 0.024, ncRating: 19, throwFt: { t50: 9.5, t100: 6, t150: 3.5 } },
      { cfm: 400, deltaPInWg: 0.082, ncRating: 28, throwFt: { t50: 18, t100: 11.5, t150: 7 } },
      { cfm: 600, deltaPInWg: 0.17, ncRating: 36, throwFt: { t50: 25, t100: 16, t150: 10 } },
      { cfm: 800, deltaPInWg: 0.29, ncRating: 43, throwFt: { t50: 32, t100: 21, t150: 13.5 } }
    ],
    costIndex: 48,
    provenance: { source: 'Al-Andalosia Directional Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-2scd-corner-12x12',
    manufacturer: 'Al-Andalosia',
    model: 'Model 2-SCD 2-Way (Corner) Square Diffuser 12"x12"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 12, height: 12 },
    faceSizeIn: { width: 18, height: 18 },
    minCfm: 200,
    maxCfm: 800,
    performanceTable: [
      { cfm: 200, deltaPInWg: 0.024, ncRating: 19, throwFt: { t50: 9, t100: 5.5, t150: 3.5 } },
      { cfm: 400, deltaPInWg: 0.082, ncRating: 28, throwFt: { t50: 17.5, t100: 11, t150: 6.5 } },
      { cfm: 600, deltaPInWg: 0.17, ncRating: 36, throwFt: { t50: 24.5, t100: 15.5, t150: 9.5 } },
      { cfm: 800, deltaPInWg: 0.29, ncRating: 43, throwFt: { t50: 31, t100: 20, t150: 13 } }
    ],
    costIndex: 48,
    provenance: { source: 'Al-Andalosia Directional Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-1scd-12x12',
    manufacturer: 'Al-Andalosia',
    model: 'Model 1-SCD 1-Way Square Diffuser 12"x12"',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 12, height: 12 },
    faceSizeIn: { width: 18, height: 18 },
    minCfm: 200,
    maxCfm: 800,
    performanceTable: [
      { cfm: 200, deltaPInWg: 0.026, ncRating: 20, throwFt: { t50: 12, t100: 7.5, t150: 4.5 } },
      { cfm: 400, deltaPInWg: 0.09, ncRating: 30, throwFt: { t50: 23, t100: 14.5, t150: 9 } },
      { cfm: 600, deltaPInWg: 0.19, ncRating: 38, throwFt: { t50: 32, t100: 21, t150: 13 } },
      { cfm: 800, deltaPInWg: 0.32, ncRating: 45, throwFt: { t50: 40, t100: 26.5, t150: 17 } }
    ],
    costIndex: 46,
    provenance: { source: 'Al-Andalosia Directional Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-ccd-6in',
    manufacturer: 'Al-Andalosia',
    model: 'Model CCD Circular Ceiling Diffuser 6" Neck (Ø12" Face)',
    terminalType: 'round-ceiling',
    neckSizeIn: { width: 6, height: 6, diameter: 6 },
    faceSizeIn: { width: 12, height: 12 },
    minCfm: 60,
    maxCfm: 315,
    performanceTable: [
      { cfm: 60, deltaPInWg: 0.025, ncRating: 15, throwFt: { t50: 5, t100: 3, t150: 2 } },
      { cfm: 100, deltaPInWg: 0.061, ncRating: 19, throwFt: { t50: 6, t100: 4, t150: 2.5 } },
      { cfm: 155, deltaPInWg: 0.132, ncRating: 25, throwFt: { t50: 6.5, t100: 4.5, t150: 3 } },
      { cfm: 235, deltaPInWg: 0.282, ncRating: 35, throwFt: { t50: 7.5, t100: 5.5, t150: 3.5 } },
      { cfm: 315, deltaPInWg: 0.48, ncRating: 45, throwFt: { t50: 10, t100: 7, t150: 4.5 } }
    ],
    costIndex: 32,
    provenance: { source: 'Al-Andalosia Circular Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-ccd-8in',
    manufacturer: 'Al-Andalosia',
    model: 'Model CCD Circular Ceiling Diffuser 8" Neck (Ø16" Face)',
    terminalType: 'round-ceiling',
    neckSizeIn: { width: 8, height: 8, diameter: 8 },
    faceSizeIn: { width: 16, height: 16 },
    minCfm: 105,
    maxCfm: 560,
    performanceTable: [
      { cfm: 105, deltaPInWg: 0.021, ncRating: 15, throwFt: { t50: 6, t100: 4, t150: 2.5 } },
      { cfm: 175, deltaPInWg: 0.052, ncRating: 18, throwFt: { t50: 7, t100: 5, t150: 3 } },
      { cfm: 280, deltaPInWg: 0.122, ncRating: 29, throwFt: { t50: 8, t100: 6, t150: 4 } },
      { cfm: 420, deltaPInWg: 0.271, ncRating: 38, throwFt: { t50: 11, t100: 7.5, t150: 5 } },
      { cfm: 560, deltaPInWg: 0.48, ncRating: 46, throwFt: { t50: 14, t100: 9, t150: 6.5 } }
    ],
    costIndex: 40,
    provenance: { source: 'Al-Andalosia Circular Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-ccd-10in',
    manufacturer: 'Al-Andalosia',
    model: 'Model CCD Circular Ceiling Diffuser 10" Neck (Ø20" Face)',
    terminalType: 'round-ceiling',
    neckSizeIn: { width: 10, height: 10, diameter: 10 },
    faceSizeIn: { width: 20, height: 20 },
    minCfm: 165,
    maxCfm: 870,
    performanceTable: [
      { cfm: 165, deltaPInWg: 0.019, ncRating: 15, throwFt: { t50: 7, t100: 4.5, t150: 3 } },
      { cfm: 275, deltaPInWg: 0.05, ncRating: 19, throwFt: { t50: 8.5, t100: 6, t150: 4 } },
      { cfm: 435, deltaPInWg: 0.12, ncRating: 30, throwFt: { t50: 10.5, t100: 7.5, t150: 5 } },
      { cfm: 655, deltaPInWg: 0.281, ncRating: 39, throwFt: { t50: 14, t100: 10, t150: 6.5 } },
      { cfm: 870, deltaPInWg: 0.477, ncRating: 47, throwFt: { t50: 18, t100: 12.5, t150: 8.5 } }
    ],
    costIndex: 50,
    provenance: { source: 'Al-Andalosia Circular Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-ccd-12in',
    manufacturer: 'Al-Andalosia',
    model: 'Model CCD Circular Ceiling Diffuser 12" Neck (Ø24" Face)',
    terminalType: 'round-ceiling',
    neckSizeIn: { width: 12, height: 12, diameter: 12 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 235,
    maxCfm: 1260,
    performanceTable: [
      { cfm: 235, deltaPInWg: 0.018, ncRating: 16, throwFt: { t50: 8, t100: 5.5, t150: 3.5 } },
      { cfm: 395, deltaPInWg: 0.048, ncRating: 21, throwFt: { t50: 10, t100: 7, t150: 4.5 } },
      { cfm: 630, deltaPInWg: 0.118, ncRating: 31, throwFt: { t50: 13, t100: 9, t150: 6 } },
      { cfm: 945, deltaPInWg: 0.278, ncRating: 40, throwFt: { t50: 17.5, t100: 12, t150: 8 } },
      { cfm: 1260, deltaPInWg: 0.475, ncRating: 48, throwFt: { t50: 22, t100: 15, t150: 10.5 } }
    ],
    costIndex: 62,
    provenance: { source: 'Al-Andalosia Circular Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-ccd-14in',
    manufacturer: 'Al-Andalosia',
    model: 'Model CCD Circular Ceiling Diffuser 14" Neck (Ø28" Face)',
    terminalType: 'round-ceiling',
    neckSizeIn: { width: 14, height: 14, diameter: 14 },
    faceSizeIn: { width: 28, height: 28 },
    minCfm: 320,
    maxCfm: 1710,
    performanceTable: [
      { cfm: 320, deltaPInWg: 0.017, ncRating: 16, throwFt: { t50: 9, t100: 6, t150: 4 } },
      { cfm: 535, deltaPInWg: 0.046, ncRating: 22, throwFt: { t50: 12, t100: 8.5, t150: 5.5 } },
      { cfm: 855, deltaPInWg: 0.115, ncRating: 32, throwFt: { t50: 15.5, t100: 11, t150: 7.5 } },
      { cfm: 1285, deltaPInWg: 0.27, ncRating: 41, throwFt: { t50: 21, t100: 14.5, t150: 9.5 } },
      { cfm: 1710, deltaPInWg: 0.465, ncRating: 49, throwFt: { t50: 27, t100: 18.5, t150: 12.5 } }
    ],
    costIndex: 76,
    provenance: { source: 'Al-Andalosia Circular Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-ccd-16in',
    manufacturer: 'Al-Andalosia',
    model: 'Model CCD Circular Ceiling Diffuser 16" Neck (Ø32" Face)',
    terminalType: 'round-ceiling',
    neckSizeIn: { width: 16, height: 16, diameter: 16 },
    faceSizeIn: { width: 32, height: 32 },
    minCfm: 420,
    maxCfm: 2240,
    performanceTable: [
      { cfm: 420, deltaPInWg: 0.016, ncRating: 17, throwFt: { t50: 10.5, t100: 7, t150: 4.5 } },
      { cfm: 700, deltaPInWg: 0.044, ncRating: 23, throwFt: { t50: 14, t100: 9.5, t150: 6.5 } },
      { cfm: 1120, deltaPInWg: 0.112, ncRating: 33, throwFt: { t50: 18.5, t100: 12.5, t150: 8.5 } },
      { cfm: 1680, deltaPInWg: 0.265, ncRating: 42, throwFt: { t50: 25, t100: 17, t150: 11.5 } },
      { cfm: 2240, deltaPInWg: 0.455, ncRating: 50, throwFt: { t50: 32, t100: 22, t150: 15 } }
    ],
    costIndex: 90,
    provenance: { source: 'Al-Andalosia Circular Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-ccd-18in',
    manufacturer: 'Al-Andalosia',
    model: 'Model CCD Circular Ceiling Diffuser 18" Neck (Ø36" Face)',
    terminalType: 'round-ceiling',
    neckSizeIn: { width: 18, height: 18, diameter: 18 },
    faceSizeIn: { width: 36, height: 36 },
    minCfm: 530,
    maxCfm: 2830,
    performanceTable: [
      { cfm: 530, deltaPInWg: 0.015, ncRating: 18, throwFt: { t50: 12, t100: 8, t150: 5.5 } },
      { cfm: 885, deltaPInWg: 0.042, ncRating: 24, throwFt: { t50: 16, t100: 11, t150: 7.5 } },
      { cfm: 1415, deltaPInWg: 0.108, ncRating: 34, throwFt: { t50: 21, t100: 14.5, t150: 10 } },
      { cfm: 2125, deltaPInWg: 0.258, ncRating: 43, throwFt: { t50: 28.5, t100: 19.5, t150: 13.5 } },
      { cfm: 2830, deltaPInWg: 0.445, ncRating: 51, throwFt: { t50: 37, t100: 25.5, t150: 17.5 } }
    ],
    costIndex: 105,
    provenance: { source: 'Al-Andalosia Circular Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-ccd-20in',
    manufacturer: 'Al-Andalosia',
    model: 'Model CCD Circular Ceiling Diffuser 20" Neck (Ø40" Face)',
    terminalType: 'round-ceiling',
    neckSizeIn: { width: 20, height: 20, diameter: 20 },
    faceSizeIn: { width: 40, height: 40 },
    minCfm: 655,
    maxCfm: 3500,
    performanceTable: [
      { cfm: 655, deltaPInWg: 0.015, ncRating: 18, throwFt: { t50: 13.5, t100: 9, t150: 6 } },
      { cfm: 1090, deltaPInWg: 0.04, ncRating: 25, throwFt: { t50: 18, t100: 12.5, t150: 8.5 } },
      { cfm: 1745, deltaPInWg: 0.105, ncRating: 35, throwFt: { t50: 24, t100: 16.5, t150: 11.5 } },
      { cfm: 2620, deltaPInWg: 0.25, ncRating: 44, throwFt: { t50: 32.5, t100: 22, t150: 15 } },
      { cfm: 3500, deltaPInWg: 0.435, ncRating: 52, throwFt: { t50: 42, t100: 29, t150: 20 } }
    ],
    costIndex: 120,
    provenance: { source: 'Al-Andalosia Circular Ceiling Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lsd-1slot-48in',
    manufacturer: 'Al-Andalosia',
    model: 'Model LSD Linear Slot Diffuser 1-Slot 48" Length (3/4" Slot)',
    terminalType: 'linear-slot',
    neckSizeIn: { width: 48, height: 1.6 },
    faceSizeIn: { width: 48, height: 3 },
    minCfm: 50,
    maxCfm: 200,
    performanceTable: [
      { cfm: 50, deltaPInWg: 0.02, ncRating: 15, throwFt: { t50: 7, t100: 4.5, t150: 3 } },
      { cfm: 100, deltaPInWg: 0.055, ncRating: 24, throwFt: { t50: 12, t100: 8, t150: 5.5 } },
      { cfm: 150, deltaPInWg: 0.11, ncRating: 33, throwFt: { t50: 16, t100: 11, t150: 7.5 } },
      { cfm: 200, deltaPInWg: 0.18, ncRating: 40, throwFt: { t50: 20, t100: 13.5, t150: 9.5 } }
    ],
    costIndex: 45,
    provenance: { source: 'Al-Andalosia Linear Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lsd-2slot-48in',
    manufacturer: 'Al-Andalosia',
    model: 'Model LSD Linear Slot Diffuser 2-Slot 48" Length (3/4" Slot)',
    terminalType: 'linear-slot',
    neckSizeIn: { width: 48, height: 3.1 },
    faceSizeIn: { width: 48, height: 4.5 },
    minCfm: 100,
    maxCfm: 400,
    performanceTable: [
      { cfm: 100, deltaPInWg: 0.02, ncRating: 16, throwFt: { t50: 9.5, t100: 6.5, t150: 4.5 } },
      { cfm: 200, deltaPInWg: 0.055, ncRating: 25, throwFt: { t50: 16, t100: 11, t150: 7.5 } },
      { cfm: 300, deltaPInWg: 0.11, ncRating: 34, throwFt: { t50: 21, t100: 14.5, t150: 10 } },
      { cfm: 400, deltaPInWg: 0.18, ncRating: 41, throwFt: { t50: 26, t100: 18, t150: 12.5 } }
    ],
    costIndex: 65,
    provenance: { source: 'Al-Andalosia Linear Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lsd-3slot-48in',
    manufacturer: 'Al-Andalosia',
    model: 'Model LSD Linear Slot Diffuser 3-Slot 48" Length (3/4" Slot)',
    terminalType: 'linear-slot',
    neckSizeIn: { width: 48, height: 4.7 },
    faceSizeIn: { width: 48, height: 6.1 },
    minCfm: 150,
    maxCfm: 600,
    performanceTable: [
      { cfm: 150, deltaPInWg: 0.02, ncRating: 17, throwFt: { t50: 11.5, t100: 8, t150: 5.5 } },
      { cfm: 300, deltaPInWg: 0.055, ncRating: 26, throwFt: { t50: 19.5, t100: 13.5, t150: 9 } },
      { cfm: 450, deltaPInWg: 0.11, ncRating: 35, throwFt: { t50: 25.5, t100: 17.5, t150: 12 } },
      { cfm: 600, deltaPInWg: 0.18, ncRating: 42, throwFt: { t50: 31, t100: 21.5, t150: 15 } }
    ],
    costIndex: 85,
    provenance: { source: 'Al-Andalosia Linear Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lsd-4slot-48in',
    manufacturer: 'Al-Andalosia',
    model: 'Model LSD Linear Slot Diffuser 4-Slot 48" Length (3/4" Slot)',
    terminalType: 'linear-slot',
    neckSizeIn: { width: 48, height: 6.3 },
    faceSizeIn: { width: 48, height: 7.7 },
    minCfm: 200,
    maxCfm: 800,
    performanceTable: [
      { cfm: 200, deltaPInWg: 0.02, ncRating: 18, throwFt: { t50: 13, t100: 9, t150: 6 } },
      { cfm: 400, deltaPInWg: 0.055, ncRating: 27, throwFt: { t50: 22, t100: 15, t150: 10.5 } },
      { cfm: 600, deltaPInWg: 0.11, ncRating: 36, throwFt: { t50: 29, t100: 20, t150: 14 } },
      { cfm: 800, deltaPInWg: 0.18, ncRating: 43, throwFt: { t50: 35, t100: 24.5, t150: 17 } }
    ],
    costIndex: 105,
    provenance: { source: 'Al-Andalosia Linear Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lsd-5slot-48in',
    manufacturer: 'Al-Andalosia',
    model: 'Model LSD Linear Slot Diffuser 5-Slot 48" Length (3/4" Slot)',
    terminalType: 'linear-slot',
    neckSizeIn: { width: 48, height: 7.8 },
    faceSizeIn: { width: 48, height: 9.2 },
    minCfm: 250,
    maxCfm: 1000,
    performanceTable: [
      { cfm: 250, deltaPInWg: 0.02, ncRating: 19, throwFt: { t50: 14.5, t100: 10, t150: 7 } },
      { cfm: 500, deltaPInWg: 0.055, ncRating: 28, throwFt: { t50: 24.5, t100: 17, t150: 12 } },
      { cfm: 750, deltaPInWg: 0.11, ncRating: 37, throwFt: { t50: 32, t100: 22.5, t150: 15.5 } },
      { cfm: 1000, deltaPInWg: 0.18, ncRating: 44, throwFt: { t50: 39, t100: 27, t150: 19 } }
    ],
    costIndex: 125,
    provenance: { source: 'Al-Andalosia Linear Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lsd-6slot-48in',
    manufacturer: 'Al-Andalosia',
    model: 'Model LSD Linear Slot Diffuser 6-Slot 48" Length (3/4" Slot)',
    terminalType: 'linear-slot',
    neckSizeIn: { width: 48, height: 9.4 },
    faceSizeIn: { width: 48, height: 10.8 },
    minCfm: 300,
    maxCfm: 1200,
    performanceTable: [
      { cfm: 300, deltaPInWg: 0.02, ncRating: 20, throwFt: { t50: 16, t100: 11, t150: 7.5 } },
      { cfm: 600, deltaPInWg: 0.055, ncRating: 29, throwFt: { t50: 27, t100: 18.5, t150: 13 } },
      { cfm: 900, deltaPInWg: 0.11, ncRating: 38, throwFt: { t50: 35, t100: 24.5, t150: 17 } },
      { cfm: 1200, deltaPInWg: 0.18, ncRating: 45, throwFt: { t50: 43, t100: 30, t150: 21 } }
    ],
    costIndex: 145,
    provenance: { source: 'Al-Andalosia Linear Diffusers Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lbg-2x48',
    manufacturer: 'Al-Andalosia',
    model: 'Model LBG Linear Bar Grille 2"x48" (0°/15° Deflection)',
    terminalType: 'sidewall-grille',
    neckSizeIn: { width: 48, height: 2 },
    faceSizeIn: { width: 48, height: 3.25 },
    minCfm: 175,
    maxCfm: 440,
    performanceTable: [
      { cfm: 175, deltaPInWg: 0.013, ncRating: 15, throwFt: { t50: 9, t100: 6, t150: 4 } },
      { cfm: 260, deltaPInWg: 0.028, ncRating: 22, throwFt: { t50: 14, t100: 9.5, t150: 6.5 } },
      { cfm: 350, deltaPInWg: 0.05, ncRating: 29, throwFt: { t50: 19, t100: 13, t150: 9 } },
      { cfm: 440, deltaPInWg: 0.077, ncRating: 35, throwFt: { t50: 24, t100: 16.5, t150: 11.5 } }
    ],
    costIndex: 40,
    provenance: { source: 'Al-Andalosia Linear Bar Grilles Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lbg-4x48',
    manufacturer: 'Al-Andalosia',
    model: 'Model LBG Linear Bar Grille 4"x48" (0°/15° Deflection)',
    terminalType: 'sidewall-grille',
    neckSizeIn: { width: 48, height: 4 },
    faceSizeIn: { width: 48, height: 5.25 },
    minCfm: 350,
    maxCfm: 880,
    performanceTable: [
      { cfm: 350, deltaPInWg: 0.013, ncRating: 16, throwFt: { t50: 13, t100: 8.5, t150: 6 } },
      { cfm: 525, deltaPInWg: 0.028, ncRating: 23, throwFt: { t50: 19.5, t100: 13.5, t150: 9 } },
      { cfm: 700, deltaPInWg: 0.05, ncRating: 30, throwFt: { t50: 26.5, t100: 18.5, t150: 12.5 } },
      { cfm: 880, deltaPInWg: 0.077, ncRating: 36, throwFt: { t50: 33.5, t100: 23.5, t150: 16 } }
    ],
    costIndex: 55,
    provenance: { source: 'Al-Andalosia Linear Bar Grilles Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lbg-6x48',
    manufacturer: 'Al-Andalosia',
    model: 'Model LBG Linear Bar Grille 6"x48" (0°/15° Deflection)',
    terminalType: 'sidewall-grille',
    neckSizeIn: { width: 48, height: 6 },
    faceSizeIn: { width: 48, height: 7.25 },
    minCfm: 525,
    maxCfm: 1320,
    performanceTable: [
      { cfm: 525, deltaPInWg: 0.013, ncRating: 17, throwFt: { t50: 16, t100: 11, t150: 7.5 } },
      { cfm: 790, deltaPInWg: 0.028, ncRating: 24, throwFt: { t50: 24, t100: 16.5, t150: 11.5 } },
      { cfm: 1050, deltaPInWg: 0.05, ncRating: 31, throwFt: { t50: 32.5, t100: 22.5, t150: 15.5 } },
      { cfm: 1320, deltaPInWg: 0.077, ncRating: 37, throwFt: { t50: 41, t100: 28.5, t150: 19.5 } }
    ],
    costIndex: 70,
    provenance: { source: 'Al-Andalosia Linear Bar Grilles Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lbg-8x48',
    manufacturer: 'Al-Andalosia',
    model: 'Model LBG Linear Bar Grille 8"x48" (0°/15° Deflection)',
    terminalType: 'sidewall-grille',
    neckSizeIn: { width: 48, height: 8 },
    faceSizeIn: { width: 48, height: 9.25 },
    minCfm: 700,
    maxCfm: 1760,
    performanceTable: [
      { cfm: 700, deltaPInWg: 0.013, ncRating: 18, throwFt: { t50: 18.5, t100: 12.5, t150: 8.5 } },
      { cfm: 1050, deltaPInWg: 0.028, ncRating: 25, throwFt: { t50: 27.5, t100: 19, t150: 13 } },
      { cfm: 1400, deltaPInWg: 0.05, ncRating: 32, throwFt: { t50: 37, t100: 26, t150: 17.5 } },
      { cfm: 1760, deltaPInWg: 0.077, ncRating: 38, throwFt: { t50: 47, t100: 32.5, t150: 22.5 } }
    ],
    costIndex: 85,
    provenance: { source: 'Al-Andalosia Linear Bar Grilles Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-lbg-12x48',
    manufacturer: 'Al-Andalosia',
    model: 'Model LBG Linear Bar Grille 12"x48" (0°/15° Deflection)',
    terminalType: 'sidewall-grille',
    neckSizeIn: { width: 48, height: 12 },
    faceSizeIn: { width: 48, height: 13.25 },
    minCfm: 1050,
    maxCfm: 2640,
    performanceTable: [
      { cfm: 1050, deltaPInWg: 0.013, ncRating: 20, throwFt: { t50: 22.5, t100: 15.5, t150: 10.5 } },
      { cfm: 1580, deltaPInWg: 0.028, ncRating: 27, throwFt: { t50: 34, t100: 23.5, t150: 16 } },
      { cfm: 2100, deltaPInWg: 0.05, ncRating: 34, throwFt: { t50: 45.5, t100: 31.5, t150: 21.5 } },
      { cfm: 2640, deltaPInWg: 0.077, ncRating: 40, throwFt: { t50: 57.5, t100: 40, t150: 27.5 } }
    ],
    costIndex: 115,
    provenance: { source: 'Al-Andalosia Linear Bar Grilles Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-jn-150mm',
    manufacturer: 'Al-Andalosia',
    model: 'Model JN Jet Nozzle Size Ø150mm (6")',
    terminalType: 'jet-nozzle',
    neckSizeIn: { width: 6, height: 6, diameter: 6 },
    faceSizeIn: { width: 9, height: 9 },
    minCfm: 75,
    maxCfm: 300,
    performanceTable: [
      { cfm: 75, deltaPInWg: 0.035, ncRating: 18, throwFt: { t50: 22, t100: 15, t150: 10 } },
      { cfm: 150, deltaPInWg: 0.14, ncRating: 30, throwFt: { t50: 44, t100: 30, t150: 20 } },
      { cfm: 225, deltaPInWg: 0.315, ncRating: 40, throwFt: { t50: 66, t100: 45, t150: 30 } },
      { cfm: 300, deltaPInWg: 0.56, ncRating: 48, throwFt: { t50: 88, t100: 60, t150: 40 } }
    ],
    costIndex: 75,
    provenance: { source: 'Al-Andalosia Jet Nozzle Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-jn-200mm',
    manufacturer: 'Al-Andalosia',
    model: 'Model JN Jet Nozzle Size Ø200mm (8")',
    terminalType: 'jet-nozzle',
    neckSizeIn: { width: 8, height: 8, diameter: 8 },
    faceSizeIn: { width: 11, height: 11 },
    minCfm: 135,
    maxCfm: 540,
    performanceTable: [
      { cfm: 135, deltaPInWg: 0.035, ncRating: 20, throwFt: { t50: 29, t100: 20, t150: 13 } },
      { cfm: 270, deltaPInWg: 0.14, ncRating: 32, throwFt: { t50: 58, t100: 40, t150: 26 } },
      { cfm: 405, deltaPInWg: 0.315, ncRating: 42, throwFt: { t50: 87, t100: 60, t150: 39 } },
      { cfm: 540, deltaPInWg: 0.56, ncRating: 50, throwFt: { t50: 116, t100: 80, t150: 52 } }
    ],
    costIndex: 95,
    provenance: { source: 'Al-Andalosia Jet Nozzle Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-jn-250mm',
    manufacturer: 'Al-Andalosia',
    model: 'Model JN Jet Nozzle Size Ø250mm (10")',
    terminalType: 'jet-nozzle',
    neckSizeIn: { width: 10, height: 10, diameter: 10 },
    faceSizeIn: { width: 13, height: 13 },
    minCfm: 210,
    maxCfm: 840,
    performanceTable: [
      { cfm: 210, deltaPInWg: 0.035, ncRating: 22, throwFt: { t50: 36, t100: 25, t150: 16 } },
      { cfm: 420, deltaPInWg: 0.14, ncRating: 34, throwFt: { t50: 72, t100: 50, t150: 32 } },
      { cfm: 630, deltaPInWg: 0.315, ncRating: 44, throwFt: { t50: 108, t100: 75, t150: 48 } },
      { cfm: 840, deltaPInWg: 0.56, ncRating: 52, throwFt: { t50: 144, t100: 100, t150: 64 } }
    ],
    costIndex: 120,
    provenance: { source: 'Al-Andalosia Jet Nozzle Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-jn-300mm',
    manufacturer: 'Al-Andalosia',
    model: 'Model JN Jet Nozzle Size Ø300mm (12")',
    terminalType: 'jet-nozzle',
    neckSizeIn: { width: 12, height: 12, diameter: 12 },
    faceSizeIn: { width: 15, height: 15 },
    minCfm: 300,
    maxCfm: 1200,
    performanceTable: [
      { cfm: 300, deltaPInWg: 0.035, ncRating: 24, throwFt: { t50: 43, t100: 30, t150: 19 } },
      { cfm: 600, deltaPInWg: 0.14, ncRating: 36, throwFt: { t50: 86, t100: 60, t150: 38 } },
      { cfm: 900, deltaPInWg: 0.315, ncRating: 46, throwFt: { t50: 129, t100: 90, t150: 57 } },
      { cfm: 1200, deltaPInWg: 0.56, ncRating: 54, throwFt: { t50: 172, t100: 120, t150: 76 } }
    ],
    costIndex: 150,
    provenance: { source: 'Al-Andalosia Jet Nozzle Catalog', version: '2024.1' }
  },
  {
    id: 'dif-andalosia-jn-400mm',
    manufacturer: 'Al-Andalosia',
    model: 'Model JN Jet Nozzle Size Ø400mm (16")',
    terminalType: 'jet-nozzle',
    neckSizeIn: { width: 16, height: 16, diameter: 16 },
    faceSizeIn: { width: 19, height: 19 },
    minCfm: 540,
    maxCfm: 2160,
    performanceTable: [
      { cfm: 540, deltaPInWg: 0.035, ncRating: 26, throwFt: { t50: 58, t100: 40, t150: 26 } },
      { cfm: 1080, deltaPInWg: 0.14, ncRating: 38, throwFt: { t50: 116, t100: 80, t150: 52 } },
      { cfm: 1620, deltaPInWg: 0.315, ncRating: 48, throwFt: { t50: 174, t100: 120, t150: 78 } },
      { cfm: 2160, deltaPInWg: 0.56, ncRating: 56, throwFt: { t50: 232, t100: 160, t150: 104 } }
    ],
    costIndex: 210,
    provenance: { source: 'Al-Andalosia Jet Nozzle Catalog', version: '2024.1' }
  },
  {
    id: 'louver-andalosia-24x24',
    manufacturer: 'Al-Andalosia',
    model: 'WL Weatherproof External Louver 24"x24"',
    terminalType: 'louver',
    neckSizeIn: { width: 24, height: 24 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 400,
    maxCfm: 1600,
    performanceTable: [
      { cfm: 400, deltaPInWg: 0.019, ncRating: 15, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 800, deltaPInWg: 0.063, ncRating: 22, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 1200, deltaPInWg: 0.123, ncRating: 31, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 1600, deltaPInWg: 0.21, ncRating: 39, throwFt: { t50: 0, t100: 0, t150: 0 } }
    ],
    costIndex: 60,
    provenance: { source: 'Al-Andalosia External Louvers Catalog', version: '2024.1' }
  },
  {
    id: 'louver-andalosia-36x36',
    manufacturer: 'Al-Andalosia',
    model: 'WL Weatherproof External Louver 36"x36"',
    terminalType: 'louver',
    neckSizeIn: { width: 36, height: 36 },
    faceSizeIn: { width: 36, height: 36 },
    minCfm: 900,
    maxCfm: 3600,
    performanceTable: [
      { cfm: 900, deltaPInWg: 0.019, ncRating: 16, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 1800, deltaPInWg: 0.063, ncRating: 24, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 2700, deltaPInWg: 0.123, ncRating: 33, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 3600, deltaPInWg: 0.21, ncRating: 41, throwFt: { t50: 0, t100: 0, t150: 0 } }
    ],
    costIndex: 95,
    provenance: { source: 'Al-Andalosia External Louvers Catalog', version: '2024.1' }
  },
  {
    id: 'louver-andalosia-48x48',
    manufacturer: 'Al-Andalosia',
    model: 'WL Weatherproof External Louver 48"x48"',
    terminalType: 'louver',
    neckSizeIn: { width: 48, height: 48 },
    faceSizeIn: { width: 48, height: 48 },
    minCfm: 1600,
    maxCfm: 6400,
    performanceTable: [
      { cfm: 1600, deltaPInWg: 0.019, ncRating: 18, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 3200, deltaPInWg: 0.063, ncRating: 26, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 4800, deltaPInWg: 0.123, ncRating: 35, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 6400, deltaPInWg: 0.21, ncRating: 43, throwFt: { t50: 0, t100: 0, t150: 0 } }
    ],
    costIndex: 140,
    provenance: { source: 'Al-Andalosia External Louvers Catalog', version: '2024.1' }
  },
  {
    id: 'sand-trap-trox-wsl-1000x1000',
    manufacturer: 'Trox',
    model: 'Type WSL Sand Trap Louver 40"x40" (1000x1000mm)',
    terminalType: 'sand-trap-louver',
    neckSizeIn: { width: 40, height: 40 },
    faceSizeIn: { width: 40, height: 40 },
    minCfm: 1100,
    maxCfm: 4400,
    performanceTable: [
      { cfm: 1100, deltaPInWg: 0.04, ncRating: 16, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 2200, deltaPInWg: 0.14, ncRating: 28, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 3300, deltaPInWg: 0.32, ncRating: 39, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 4400, deltaPInWg: 0.58, ncRating: 48, throwFt: { t50: 0, t100: 0, t150: 0 } }
    ],
    costIndex: 180,
    provenance: { source: 'Trox Sand Trap Louvers Catalog', version: '2024.1' }
  },
  {
    id: 'sand-trap-trox-wsl-1500x1500',
    manufacturer: 'Trox',
    model: 'Type WSL Sand Trap Louver 60"x60" (1500x1500mm)',
    terminalType: 'sand-trap-louver',
    neckSizeIn: { width: 60, height: 60 },
    faceSizeIn: { width: 60, height: 60 },
    minCfm: 2500,
    maxCfm: 10000,
    performanceTable: [
      { cfm: 2500, deltaPInWg: 0.04, ncRating: 18, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 5000, deltaPInWg: 0.14, ncRating: 30, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 7500, deltaPInWg: 0.32, ncRating: 41, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 10000, deltaPInWg: 0.58, ncRating: 50, throwFt: { t50: 0, t100: 0, t150: 0 } }
    ],
    costIndex: 260,
    provenance: { source: 'Trox Sand Trap Louvers Catalog', version: '2024.1' }
  }
];

/**
 * Standard Duct Types
 */
export const STANDARD_DUCT_TYPES: DuctTypeItem[] = [
  {
    id: 'duct-rect-galv',
    name: 'Rectangular Sheet Metal (Galvanized)',
    shape: 'rectangular',
    material: 'galvanized-steel',
    roughnessFt: 0.0003,
    maxRecommendedVelocityFpm: 1200,
    maxFrictionRateInWgPer100Ft: 0.10,
    costFactorPerFt: 1.0,
    insulationRValue: 4.2
  },
  {
    id: 'duct-round-spiral',
    name: 'Round Spiral Duct (Galvanized)',
    shape: 'round',
    material: 'galvanized-steel',
    roughnessFt: 0.00015,
    maxRecommendedVelocityFpm: 1500,
    maxFrictionRateInWgPer100Ft: 0.12,
    costFactorPerFt: 0.85,
    insulationRValue: 4.2
  },
  {
    id: 'duct-flex',
    name: 'Flexible Aluminum Duct (Runout)',
    shape: 'flex',
    material: 'flexible-aluminum',
    roughnessFt: 0.003,
    maxRecommendedVelocityFpm: 700,
    maxFrictionRateInWgPer100Ft: 0.15,
    costFactorPerFt: 0.50,
    insulationRValue: 6.0
  }
];

/**
 * Fitting Loss Coefficients (K-factor referenced to local cross-section velocity)
 */
/**
 * Fitting Loss Coefficients (K-factor referenced to local cross-section velocity)
 */
export const STANDARD_FITTING_LOSSES: Record<string, FittingLossDefinition> = {
  'elbow-90-vaned': {
    type: 'elbow-90-vaned',
    name: '90° Rectangular Elbow with Turning Vanes',
    lossCoefficientK: 0.25
  },
  'elbow-90-unvaned': {
    type: 'elbow-90-unvaned',
    name: '90° Rectangular Elbow (Unvaned)',
    lossCoefficientK: 1.15
  },
  'elbow-45': {
    type: 'elbow-45',
    name: '45° Smooth Radius Elbow',
    lossCoefficientK: 0.18
  },
  'branch-tee': {
    type: 'branch-tee',
    name: 'Branch Take-off Conical Boot',
    lossCoefficientK: 0.35
  },
  'reducer': {
    type: 'reducer',
    name: 'Gradual Reducer Transition (< 15°)',
    lossCoefficientK: 0.10
  },
  'fire-damper': {
    type: 'fire-damper',
    name: 'Dynamic Curtain Fire Damper (UL 555 1.5 Hr)',
    lossCoefficientK: 0.35
  },
  'smoke-damper': {
    type: 'smoke-damper',
    name: 'Motorized Smoke Damper (UL 555S Class I)',
    lossCoefficientK: 0.45
  },
  'combination-fire-smoke-damper': {
    type: 'combination-fire-smoke-damper',
    name: 'Combination Fire / Smoke Damper (UL 555/555S)',
    lossCoefficientK: 0.50
  },
  'ceiling-radiation-damper': {
    type: 'ceiling-radiation-damper',
    name: 'Ceiling Radiation Damper (UL 555C)',
    lossCoefficientK: 0.30
  },
  'balancing-damper': {
    type: 'balancing-damper',
    name: 'Manual Volume Damper (Full Open)',
    lossCoefficientK: 0.15
  },
  'volume-control-damper': {
    type: 'volume-control-damper',
    name: 'Manual Opposed Blade Volume Damper (VCD)',
    lossCoefficientK: 0.25
  },
  'backdraft-damper': {
    type: 'backdraft-damper',
    name: 'Gravity Backdraft Damper (BDD)',
    lossCoefficientK: 0.35
  },
  'filter-merv8': {
    type: 'filter-merv8',
    name: 'Pleated Panel Filter (MERV 8 Clean)',
    lossCoefficientK: 0.0,
    fixedLossInWg: 0.15
  },
  'filter-merv13': {
    type: 'filter-merv13',
    name: 'High Efficiency Filter (MERV 13 Clean)',
    lossCoefficientK: 0.0,
    fixedLossInWg: 0.30
  },
  'silencer': {
    type: 'silencer',
    name: 'Duct Sound Attenuator (3-ft Silencer)',
    lossCoefficientK: 0.0,
    fixedLossInWg: 0.12
  }
};

/**
 * Standard Damper & Fire Safety Catalog (UL 555 / UL 555S / NFPA 90A - Lecture 08)
 */
export const STANDARD_DAMPER_CATALOG: DamperSpecification[] = [
  {
    "id": "dmp-fd-curtain-1.5hr",
    "manufacturer": "Al-Andalosia / Ruskin",
    "model": "FD-110 Dynamic Curtain Fire Damper (1.5 Hr)",
    "type": "fire-damper",
    "fireRatingHours": 1.5,
    "fusibleLinkTempF": 165,
    "maxVelocityFpm": 2000,
    "maxPressureInWg": 4,
    "lossCoefficientK": 0.35,
    "bladeType": "curtain",
    "dimensionsAvailable": {
      "minIn": 4,
      "maxIn": 60
    },
    "provenance": {
      "source": "Al-Andalosia Fire Damper Catalog (Lecture 08)",
      "version": "2024.1"
    }
  },
  {
    "id": "dmp-fd-curtain-3.0hr",
    "manufacturer": "Al-Andalosia / Ruskin",
    "model": "FD-310 Dynamic Curtain Fire Damper (3.0 Hr)",
    "type": "fire-damper",
    "fireRatingHours": 3,
    "fusibleLinkTempF": 212,
    "maxVelocityFpm": 2000,
    "maxPressureInWg": 4,
    "lossCoefficientK": 0.4,
    "bladeType": "curtain",
    "dimensionsAvailable": {
      "minIn": 4,
      "maxIn": 60
    },
    "provenance": {
      "source": "Al-Andalosia Fire Damper Catalog (Lecture 08)",
      "version": "2024.1"
    }
  },
  {
    "id": "dmp-fsd-211-class1",
    "manufacturer": "Greenheck",
    "model": "Model FSD-211 Combination Fire Smoke Damper (1.5 Hr, Class I)",
    "type": "combination-fire-smoke-damper",
    "fireRatingHours": 1.5,
    "leakageClass": "Class I",
    "temperatureRatingF": 350,
    "fusibleLinkTempF": 165,
    "maxVelocityFpm": 2000,
    "maxPressureInWg": 4,
    "lossCoefficientK": 0.5,
    "bladeType": "3V",
    "dimensionsAvailable": {
      "minIn": 6,
      "maxIn": 72
    },
    "provenance": {
      "source": "Greenheck FSD-211 UL 555/555S Catalog (Lecture 08)",
      "version": "2024.1"
    }
  },
  {
    "id": "dmp-sd-smoke-class1",
    "manufacturer": "Greenheck",
    "model": "Model SMD-201 Motorized Smoke Damper (Class I Leakage)",
    "type": "smoke-damper",
    "leakageClass": "Class I",
    "temperatureRatingF": 250,
    "maxVelocityFpm": 2000,
    "maxPressureInWg": 4,
    "lossCoefficientK": 0.45,
    "bladeType": "airfoil",
    "dimensionsAvailable": {
      "minIn": 6,
      "maxIn": 72
    },
    "provenance": {
      "source": "Greenheck Smoke Damper Specification (Lecture 08)",
      "version": "2024.1"
    }
  },
  {
    "id": "dmp-crd-ceiling-radiation",
    "manufacturer": "Ruskin",
    "model": "CFD-7 Ceiling Radiation Damper (UL 555C)",
    "type": "ceiling-radiation-damper",
    "fireRatingHours": 1,
    "fusibleLinkTempF": 165,
    "maxVelocityFpm": 1500,
    "maxPressureInWg": 2,
    "lossCoefficientK": 0.3,
    "bladeType": "curtain",
    "dimensionsAvailable": {
      "minIn": 6,
      "maxIn": 24
    },
    "provenance": {
      "source": "Ruskin Ceiling Damper Specification (Lecture 08)",
      "version": "2024.1"
    }
  },
  {
    "id": "dmp-vcd-opposed-manual",
    "manufacturer": "Al-Andalosia",
    "model": "Model VCD Manual Opposed Blade Volume Damper",
    "type": "volume-control-damper",
    "maxVelocityFpm": 2500,
    "maxPressureInWg": 4,
    "lossCoefficientK": 0.25,
    "bladeType": "airfoil",
    "dimensionsAvailable": {
      "minIn": 4,
      "maxIn": 60
    },
    "provenance": {
      "source": "Al-Andalosia Volume Damper Catalog (Lecture 08)",
      "version": "2024.1"
    }
  },
  {
    "id": "dmp-bdd-backdraft",
    "manufacturer": "Al-Andalosia",
    "model": "Model BDD Gravity Backdraft Damper",
    "type": "backdraft-damper",
    "maxVelocityFpm": 1500,
    "maxPressureInWg": 2,
    "lossCoefficientK": 0.35,
    "bladeType": "curtain",
    "dimensionsAvailable": {
      "minIn": 6,
      "maxIn": 36
    },
    "provenance": {
      "source": "Al-Andalosia Damper Catalog (Lecture 08)",
      "version": "2024.1"
    }
  }
];

/**
 * NFPA 90A Engineering Rules & Standards Database (Lecture 08)
 * Standard for the Installation of Air-Conditioning and Ventilating Systems
 */
export const NFPA_90A_STANDARDS_DATABASE: Nfpa90aStandardRule[] = [
  {
    "id": "nfpa-90a-supply-smoke-detector",
    "section": "NFPA 90A (2018) §6.4.2.1",
    "category": "smoke-detection",
    "title": "Supply Air System Duct Smoke Detector Requirement",
    "description": "Duct smoke detectors shall be installed in supply systems with a design capacity greater than 2,000 CFM (944 L/s) downstream of the air filters and ahead of any branch takeoffs.",
    "thresholdValue": 2000,
    "thresholdUnit": "CFM",
    "mandatoryRequirement": "Supply airflow > 2,000 CFM requires listed duct smoke detector at unit supply discharge.",
    "actionOnTrigger": "Interlock to automatically shut down fan/air handler upon smoke alarm to prevent smoke spread.",
    "standardReference": "NFPA 90A-2018 Section 6.4.2.1; UL 268A"
  },
  {
    "id": "nfpa-90a-return-smoke-detector-multistory",
    "section": "NFPA 90A (2018) §6.4.2.2",
    "category": "smoke-detection",
    "title": "Return Air System Duct Smoke Detector (Multi-Story)",
    "description": "Duct smoke detectors shall be installed at each story prior to connection to a common return and prior to any recirculation or fresh air dilution in return systems with a design capacity exceeding 15,000 CFM (7,080 L/s) serving more than one story.",
    "thresholdValue": 15000,
    "thresholdUnit": "CFM",
    "mandatoryRequirement": "Multi-story return system > 15,000 CFM requires smoke detector at each floor inlet to return shaft.",
    "actionOnTrigger": "Automatic shutdown of supply/return fans and activation of floor smoke isolation dampers.",
    "standardReference": "NFPA 90A-2018 Section 6.4.2.2"
  },
  {
    "id": "nfpa-90a-fire-damper-1hr-partition",
    "section": "NFPA 90A (2018) §5.3.1.1",
    "category": "fire-damper",
    "title": "Fire Damper Rating at 1-Hour to 2-Hour Fire Barriers",
    "description": "Approved fire dampers having a minimum 1.5-hour fire resistance rating (UL 555) shall be provided where ducts penetrate fire partitions or fire barriers having a rating of 1 or 2 hours.",
    "thresholdValue": 1,
    "thresholdUnit": "Hours Wall Fire Rating",
    "mandatoryRequirement": "Duct penetrations through 1-hr or 2-hr fire resistance walls require 1.5-hr dynamic fire dampers.",
    "actionOnTrigger": "Automatic closure via 165°F (74°C) fusible link / heat responsive device.",
    "standardReference": "NFPA 90A-2018 Section 5.3.1; UL 555"
  },
  {
    "id": "nfpa-90a-fire-damper-3hr-partition",
    "section": "NFPA 90A (2018) §5.3.1.2",
    "category": "fire-damper",
    "title": "Fire Damper Rating at 3-Hour or Greater Fire Barriers",
    "description": "Approved fire dampers having a minimum 3.0-hour fire resistance rating (UL 555) shall be provided where ducts penetrate fire barriers having a rating of 3 hours or greater.",
    "thresholdValue": 3,
    "thresholdUnit": "Hours Wall Fire Rating",
    "mandatoryRequirement": "Duct penetrations through 3-hr+ fire walls require 3.0-hr fire dampers.",
    "actionOnTrigger": "Automatic closure via 212°F (100°C) fusible link device.",
    "standardReference": "NFPA 90A-2018 Section 5.3.1.2; UL 555"
  },
  {
    "id": "nfpa-90a-smoke-damper-barriers",
    "section": "NFPA 90A (2018) §5.3.2",
    "category": "smoke-damper",
    "title": "Smoke Damper Penetration of Smoke Barriers",
    "description": "Duct penetrations through smoke barriers and smoke partitions shall be equipped with approved smoke dampers or combination fire/smoke dampers meeting UL 555S Class I or Class II leakage.",
    "thresholdValue": 1,
    "thresholdUnit": "Smoke Barrier Penetration",
    "mandatoryRequirement": "Motorized smoke damper with Class I leakage (<= 4 CFM/sq.ft at 1.0 in.wg) at smoke partitions.",
    "actionOnTrigger": "Automatic motorized closure upon smoke detector or fire alarm initiation.",
    "standardReference": "NFPA 90A-2018 Section 5.3.2; UL 555S"
  },
  {
    "id": "nfpa-90a-ceiling-radiation-damper",
    "section": "NFPA 90A (2018) §5.3.4",
    "category": "ceiling-radiation-damper",
    "title": "Ceiling Radiation Dampers at Fire-Rated Ceiling Assemblies",
    "description": "Ceiling radiation dampers (UL 555C) shall be installed at all supply and return air terminal openings penetrating fire-resistance-rated floor-ceiling or roof-ceiling assemblies.",
    "thresholdValue": 1,
    "thresholdUnit": "Rated Ceiling Opening",
    "mandatoryRequirement": "Supply/return diffusers in rated acoustic tile ceilings require listed ceiling radiation dampers.",
    "actionOnTrigger": "Thermally actuated barrier closure protecting structural steel and floor cavity.",
    "standardReference": "NFPA 90A-2018 Section 5.3.4; UL 555C"
  },
  {
    "id": "nfpa-90a-flexible-duct-length",
    "section": "NFPA 90A (2018) §4.3.2.1",
    "category": "flexible-duct",
    "title": "Flexible Air Duct Maximum Length Constraint",
    "description": "Flexible air ducts shall not exceed 14 ft (4.3 m) in length for any runout to a terminal device. Flexible air connectors shall not exceed 5 ft (1.5 m) in length.",
    "thresholdValue": 14,
    "thresholdUnit": "Feet Maximum Length",
    "mandatoryRequirement": "Flexible duct runout from rigid sheet metal branch to diffuser shall be <= 14 ft (recommended 4 to 8 ft).",
    "actionOnTrigger": "Engineering violation warning if flexible duct length exceeds 14 ft limit.",
    "standardReference": "NFPA 90A-2018 Section 4.3.2.1; UL 181 Class 1"
  },
  {
    "id": "nfpa-90a-plenum-combustibility",
    "section": "NFPA 90A (2018) §4.3.11.2",
    "category": "plenum-corridor",
    "title": "Materials within Air Plenums and Egress Enclosures",
    "description": "Materials exposed within ceiling return plenums, raised floor plenums, and air-handling enclosures shall be noncombustible or limited-combustible with Flame Spread Index <= 25 and Smoke-Developed Index <= 50.",
    "thresholdValue": 25,
    "thresholdUnit": "Flame Spread Index Max",
    "mandatoryRequirement": "All duct wrap insulation, sealants, flex ducts, and cabling in plenums must meet 25/50 ASTM E84 rating.",
    "actionOnTrigger": "Compliance verification for plenum-rated insulation and wiring.",
    "standardReference": "NFPA 90A-2018 Section 4.3.11.2; ASTM E84 / UL 723"
  },
  {
    "id": "nfpa-90a-egress-corridor-restriction",
    "section": "NFPA 90A (2018) §4.3.11.1",
    "category": "egress",
    "title": "Prohibition of Egress Corridors as Plenums",
    "description": "Exit access corridors and exit passageways in buildings shall not be used as supply, return, or exhaust air plenums.",
    "thresholdValue": 0,
    "thresholdUnit": "Egress Plenum Prohibition",
    "mandatoryRequirement": "Corridors must use fully ducted supply and return networks; transfer grilles into egress paths prohibited.",
    "actionOnTrigger": "Architecture validation flags unducted return transfer openings in exit corridors.",
    "standardReference": "NFPA 90A-2018 Section 4.3.11.1"
  }
];
