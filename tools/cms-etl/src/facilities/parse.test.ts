import { describe, expect, it } from 'vitest';
import { parsePosCsv } from './parse.ts';

const POS_HEADER =
  'prvdr_num,fac_name,prvdr_type_id,st_adr,city_name,state_cd,zip_cd,asc_bgn_srvc_dt,trmntn_exprtn_dt';

// Build a minimal POS CSV with only the columns our parser reads.
function posCsv(dataRows: string[]): string {
  return [POS_HEADER, ...dataRows].join('\n');
}

describe('parsePosCsv', () => {
  it('parses a well-formed active ASC row', () => {
    const csv = posCsv([
      '12C0001234,"Sunrise Surgical Center",11,123 Main St,Portland,OR,97201,2015-06-01,',
    ]);
    const rows = parsePosCsv(csv);
    expect(rows).toEqual([
      {
        external_id: '12C0001234',
        name: 'Sunrise Surgical Center',
        facility_type: 'asc',
        address_line1: '123 Main St',
        city: 'Portland',
        state: 'OR',
        zip: '97201',
      },
    ]);
  });

  it('skips rows with the wrong provider type', () => {
    const csv = posCsv([
      // prvdr_type_id = "03" is an HHA, not an ASC.
      '03H0009999,"Some HHA",03,1 Plaza,Boise,ID,83702,Not Applicable,Not Available',
    ]);
    expect(parsePosCsv(csv)).toEqual([]);
  });

  it('skips ASC rows with a real termination date', () => {
    const csv = posCsv([
      '12C0002222,"Closed ASC",11,9 Empty Rd,Reno,NV,89501,2010-01-01,2023-12-31',
    ]);
    expect(parsePosCsv(csv)).toEqual([]);
  });

  it('keeps rows whose trmntn_exprtn_dt is a placeholder string (active ASC)', () => {
    const csv = posCsv([
      '12C0007777,"Active ASC",11,3 Oak St,Seattle,WA,98101,2019-04-10,Not Available',
    ]);
    const rows = parsePosCsv(csv);
    expect(rows).toHaveLength(1);
  });

  it('skips rows whose asc_bgn_srvc_dt is a placeholder instead of a real date', () => {
    const csv = posCsv([
      // The POS file ships "Not Applicable" here for non-ASC-active records.
      '12C0003333,"Placeholder date",11,9 Elm St,Buffalo,NY,14201,Not Applicable,Not Available',
    ]);
    expect(parsePosCsv(csv)).toEqual([]);
  });

  it('skips rows with no CCN', () => {
    const csv = posCsv([',"No CCN ASC",11,1 Road,Austin,TX,73301,2020-01-01,']);
    expect(parsePosCsv(csv)).toEqual([]);
  });

  it('handles embedded commas in quoted facility names', () => {
    const csv = posCsv([
      '12C0004444,"Baker, Grant & Co. ASC",11,55 Vine,Denver,CO,80202,2018-03-15,',
    ]);
    const rows = parsePosCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Baker, Grant & Co. ASC');
  });

  it('uppercases state codes and null-outs malformed ones', () => {
    const csv = posCsv([
      '12C0005555,"Lowercase State",11,1 Ln,Anywhere,or,97000,2021-01-01,',
      '12C0006666,"Bad State",11,2 Ln,Elsewhere,XYZ,99999,2021-01-01,',
    ]);
    const rows = parsePosCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.state).toBe('OR');
    expect(rows[1]?.state).toBeNull();
  });
});
