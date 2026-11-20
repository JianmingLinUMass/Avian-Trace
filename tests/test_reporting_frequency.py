"""Synthetic, split-file checks for the exact EBD-derived frequency definition."""
import json
import re
import shutil
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import duckdb
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import reporting_frequency as f
import build_reporting_frequency as b
import validate_reporting_frequency as v


class ReportingFrequencyTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.source=self.root/"parquet";self.source.mkdir()
        self.base=self.root/"base";self.base.mkdir();self.work=self.root/"work";self.output=self.root/"output"
        for name in f.DATABASES:
            with duckdb.connect(str(self.base/name)) as c:
                c.execute("CREATE TABLE legacy(value INTEGER);INSERT INTO legacy VALUES (42)")
        cols=["checklist_id","complete_checklist","observation_date","taxon_id","category","state_code","county_code","locality_id","locality_type","approved","protocol"]
        rows=[
          ('S1','1','2012-01-01','a','species','US-MA','US-MA-017','L1','H','0','Incidental'),
          ('S1','1','2012-01-01','b','species','US-MA','US-MA-017','L1','H','1','Stationary'),
          ('S2','1','2012-01-02','b','species','US-MA','US-MA-017','L2','P','1','Traveling'),
          ('S3','1','2012-01-03','sub','issf','US-MA','US-MA-017','L1','H','1','Stationary'),
          ('S4','0','2012-01-04','a','species','US-MA','US-MA-017','L1','H','1','Stationary'),
          (None,'1','2012-01-05','a','species','US-MA','US-MA-017','L1','H','1','Stationary'),
          ('','1','2012-01-05','a','species','US-MA','US-MA-017','L1','H','1','Stationary'),
          ('  ','1','2012-01-05','a','species','US-MA','US-MA-017','L1','H','1','Stationary'),
          ('S8','1','2012-11-18','a','species','US-MA','US-MA-017','L3','H','1','Historical'),
          ('S8','1','2012-12-18','a','species','US-MA','US-MA-017','L3','H','1','Historical'),
          ('S9','1','2012-01-01','a','species','US-MA',None,'L1','H','1','Stationary'),
          ('S10','1','2011-12-31','a','species','US-MA','US-MA-017','L1','H','1','Stationary'),
          ('S11','1','2026-01-01','a','species','US-MA','US-MA-017','L1','H','1','Stationary'),
          ('S12','1','2012-01-01','a','species','US-CA','US-CA-001','L20','H','1','Stationary'),
        ]
        self.rows=rows
        self.write_source(self.source,rows)

    def write_source(self,path,rows):
        cols=["checklist_id","complete_checklist","observation_date","taxon_id","category","state_code","county_code","locality_id","locality_type","approved","protocol"]
        with duckdb.connect() as c:
            c.execute('CREATE TABLE raw('+','.join(key+' VARCHAR' for key in cols)+')')
            c.executemany('INSERT INTO raw VALUES ('+','.join('?' for _ in cols)+')',rows)
            c.execute('COPY raw TO ? (FORMAT PARQUET)',[str(path/'part_000.parquet')])
            # A repeated species observation across a file boundary is still one reporting checklist.
            c.execute("COPY (SELECT * FROM raw WHERE checklist_id='S1' AND taxon_id='a') TO ? (FORMAT PARQUET)",[str(path/'part_001.parquet')])

    def build(self,source=None,work=None,scope='nationwide',output=None):
        source=source or self.source;work=work or self.work
        with patch.object(b.shutil,'disk_usage',return_value=SimpleNamespace(free=10**15)):
            manifest=b.prepare(source,self.base,output or self.output,work,scope,'1GB',2)
        for year in f.YEARS:b.build_year(source,work,year,'1GB',2)
        b.finalize(work,manifest,'1GB',2)
        report=v.validate(work,manifest,'1GB',2,mark_complete=True)
        return manifest,report

    def test_exact_counts_and_independent_raw_validation(self):
        manifest,report=self.build()
        self.assertTrue(report['passed'])
        with duckdb.connect(str(self.work/'candidate/ebird.duckdb'),read_only=True) as c:
            def value(table,where):return c.execute('SELECT '+f.TABLES[table]['count']+' FROM '+table+' WHERE '+where).fetchone()[0]
            self.assertEqual(value('complete_checklists_region_month',"region_code='US-MA' AND month=1"),4)
            self.assertEqual(value('species_checklists_region_month',"region_code='US-MA' AND month=1 AND taxon_id='a'"),2)
            self.assertEqual(value('complete_checklists_region_year',"region_code='US-MA'"),5)
            self.assertEqual(c.execute("SELECT SUM(complete_checklists) FROM complete_checklists_region_month WHERE region_code='US-MA'").fetchone()[0],6)
            self.assertEqual(value('species_checklists_region_year',"region_code='US-MA-017' AND taxon_id='a'"),2)
            self.assertEqual(c.execute('SELECT * FROM legacy').fetchall(),[(42,)])
            self.assertEqual(c.execute('SELECT count(*) FROM reporting_frequency_coverage WHERE complete').fetchone()[0],168)
            self.assertEqual(c.execute('SELECT count(*) FROM complete_checklists_region_year WHERE year=2013').fetchone()[0],0)
        with duckdb.connect(str(self.work/'candidate/ebird_locations.duckdb'),read_only=True) as c:
            self.assertEqual(c.execute("SELECT complete_checklists FROM complete_checklists_hotspot_month WHERE locality_id='L1' AND month=1").fetchone()[0],2)
            self.assertEqual(c.execute("SELECT reporting_checklists FROM species_checklists_hotspot_month WHERE locality_id='L1' AND month=1 AND taxon_id='a'").fetchone()[0],1)
            self.assertEqual(c.execute("SELECT complete_checklists FROM complete_checklists_hotspot_year WHERE locality_id='L3'").fetchone()[0],1)
            self.assertEqual(c.execute("SELECT count(*) FROM complete_checklists_hotspot_month WHERE locality_id='L2'").fetchone()[0],0)
        with duckdb.connect(str(self.work/'candidate/ebird.duckdb')) as c:
            c.execute("INSERT INTO complete_checklists_region_month VALUES ('state','US-XX',NULL,1,1)")
        with self.assertRaisesRegex(ValueError,'coverage'):
            v.invariants(self.work/'candidate',self.work,'1GB',2)
        with duckdb.connect(str(self.work/'candidate/ebird.duckdb')) as c:
            c.execute("DELETE FROM complete_checklists_region_month WHERE year IS NULL")
            c.execute("UPDATE complete_checklists_region_month SET complete_checklists=complete_checklists+1 WHERE region_code='US-MA'")
        with self.assertRaisesRegex(ValueError,'differing rows|bounds fail'):
            v.validate(self.work,manifest,'1GB',2)

    def test_checkpoints_and_snapshot_identity(self):
        with patch.object(b.shutil,'disk_usage',return_value=SimpleNamespace(free=10**15)):
            b.prepare(self.source,self.base,self.output,self.work,'nationwide','1GB',2)
        b.build_year(self.source,self.work,2012,'1GB',2)
        with b.build_lock(self.work/'locks/2012'):
            with self.assertRaises(OSError): b.build_year(self.source,self.work,2012,'1GB',2)
        with patch.object(b,'connection',side_effect=AssertionError('Completed year was reprocessed')):
            b.build_year(self.source,self.work,2012,'1GB',2)
        (self.work/'years/2012/complete_checklists_region_month.parquet').write_bytes(b'broken')
        b.build_year(self.source,self.work,2012,'1GB',2)
        self.assertTrue(f.verified_year(self.work/'years/2012'))
        partial=self.work/'years/2013.incomplete';partial.mkdir();(partial/'interrupted').write_text('partial')
        b.build_year(self.source,self.work,2013,'1GB',2)
        self.assertFalse(partial.exists())
        with self.assertRaises(FileExistsError):b.prepare(self.source,self.base,self.output,self.work,'nationwide','1GB',2)
        with (self.source/'part_000.parquet').open('ab') as file:file.write(b'changed')
        with self.assertRaisesRegex(ValueError,'snapshot|policy'):
            b.prepare(self.source,self.base,self.output,self.work,'nationwide','1GB',2,True)
        with self.assertRaises(ValueError):b.prepare(self.source,self.base,self.output,self.source,'nationwide','1GB',2)

    def test_invalid_cli_work_path_creates_no_source_lock(self):
        args=['build_reporting_frequency.py','--input',str(self.source),'--base-databases',str(self.base),
            '--output-databases',str(self.output),'--work',str(self.source/'unsafe'),'--scope','nationwide']
        before=sorted(p.name for p in self.source.iterdir())
        with patch.object(sys,'argv',args),self.assertRaisesRegex(ValueError,'separate'):
            b.main()
        self.assertEqual(sorted(p.name for p in self.source.iterdir()),before)

    def test_parallel_year_work_is_isolated_and_validated(self):
        with patch.object(b.shutil,'disk_usage',return_value=SimpleNamespace(free=10**15)):
            manifest=b.prepare(self.source,self.base,self.output,self.work,'nationwide','1GB',1)
        b.build_years(self.source,self.work,manifest,'1GB',1,2)
        self.assertEqual(manifest['years'],list(f.YEARS))
        b.finalize(self.work,manifest,'1GB',1)
        self.assertTrue(v.validate(self.work,manifest,'1GB',1,2)['passed'])

    def test_unknown_work_directory_is_never_overwritten(self):
        self.work.mkdir();sentinel=self.work/'unrelated.txt';sentinel.write_text('keep')
        with self.assertRaisesRegex(FileExistsError,'Nonempty work'):
            b.prepare(self.source,self.base,self.output,self.work,'nationwide','1GB',2)
        self.assertEqual(sentinel.read_text(),'keep')

    def test_cross_scope_and_publication_rollback(self):
        manifest,report=self.build(output=self.base)
        ma_source=self.root/'ma-source';ma_source.mkdir();self.write_source(ma_source,[row for row in self.rows if row[5]=='US-MA'])
        ma_work=self.root/'ma-work';ma_manifest,ma_report=self.build(ma_source,ma_work,'US-MA')
        v.compare_massachusetts(self.work/'candidate',ma_work/'candidate','1GB',2,self.root/'cross-scope-scratch')
        # The separate MA destination starts empty; the base directory is retained.
        b.publish(ma_work,ma_manifest)
        self.assertEqual(ma_report['candidate_hashes'],{name:f.digest(self.output/name) for name in f.DATABASES})
        before={name:f.digest(self.base/name) for name in f.DATABASES}
        replace=Path.replace
        def fail(source,target):
            if source.name.startswith('frequency_') and Path(target).name=='ebird_daily.duckdb':raise PermissionError('simulated lock')
            return replace(source,target)
        with patch.object(Path,'replace',fail),self.assertRaises(PermissionError):b.publish(self.work,manifest)
        self.assertEqual(before,{name:f.digest(self.base/name) for name in f.DATABASES})
        b.publish(self.work,manifest)
        self.assertEqual(report['candidate_hashes'],{name:f.digest(self.base/name) for name in f.DATABASES})
        self.assertEqual(json.loads((self.work/'publication.json').read_text())['status'],'published')
        with self.assertRaisesRegex(ValueError,'Destination changed'):
            b.publish(self.work,manifest)


    def test_portable_defaults_overrides_and_scratch_guards(self):
        with patch.object(f, 'REPO_ROOT', self.root):
            nationwide = b.parse_args([])
            ma = b.parse_args(['--scope', 'US-MA'])
            self.assertEqual(nationwide.input, self.root / 'parquet/production')
            self.assertEqual(nationwide.base_databases, self.root / 'database')
            self.assertEqual(nationwide.output_databases, self.root / 'database')
            self.assertEqual(ma.input, self.root / 'parquet_ma/production')
            self.assertEqual(ma.base_databases, self.root / 'database_ma')
            self.assertEqual(ma.output_databases, self.root / 'database_ma')
            self.assertEqual(ma.work, self.root / '.reporting-frequency/massachusetts')
        args = b.parse_args(['--input', str(self.source), '--base-databases', str(self.base),
            '--output-databases', str(self.output), '--checkpoint-directory', str(self.work),
            '--scratch-directory', str(self.root / 'scratch'), '--threads', '2', '--workers', '2'])
        self.assertEqual(args.work, self.work)
        self.assertEqual(args.scratch_directory, self.root / 'scratch')
        for protected in [self.source, self.base, self.work / 'candidate', self.work / 'years', self.work / 'originals']:
            with self.assertRaises(ValueError): f.scratch_path(self.work, protected, (self.source, self.base))

    def test_read_only_validation_and_completed_resume_preserve_evidence(self):
        with patch.object(b.shutil, 'disk_usage', return_value=SimpleNamespace(free=10**15)):
            manifest = b.prepare(self.source, self.base, self.output, self.work, 'nationwide', '1GB', 2)
        scratch = self.root / 'custom-scratch'
        b.build_years(self.source, self.work, manifest, '1GB', 2, 1, scratch)
        b.finalize(self.work, manifest, '1GB', 2)
        before = {name:f.digest(self.work / 'candidate' / name) for name in f.DATABASES}
        saved_manifest = (self.work / 'manifest.json').read_bytes()
        pause = self.work / 'PAUSE_BEFORE_VALIDATION'
        pause.write_text('Keep this marker')
        command = ['--work', str(self.work), '--ignore-pause', '--scratch-directory', str(scratch),
                   '--memory-limit', '1GB', '--threads', '2']
        report = v.main(command + ['--report', str(self.work / 'validation.json')])
        self.assertTrue(report['passed'])
        self.assertFalse(report['completion_flags_updated'])
        self.assertEqual(before, report['candidate_hashes'])
        self.assertEqual(saved_manifest, (self.work / 'manifest.json').read_bytes())
        self.assertEqual(pause.read_text(), 'Keep this marker')
        with duckdb.connect(str(self.work / 'candidate/ebird.duckdb'), read_only=True) as con:
            self.assertEqual(con.execute('SELECT complete FROM reporting_frequency_build').fetchall(), [(False,)])
        with self.assertRaisesRegex(ValueError, 'completion flags'):
            b.publish(self.work, manifest)
        with patch.object(v, 'expected_sql', side_effect=AssertionError('Validated year was recomputed')):
            v.main(command + ['--report', str(self.root / 'second-audit.json')])
        with patch.object(b, 'build_years', side_effect=AssertionError('Aggregation restarted')), \
             patch.object(b, 'finalize', side_effect=AssertionError('Candidate reconstructed')), \
             patch.object(v, 'validate', return_value={'passed':True}) as audit:
            b.main(['--input', str(self.source), '--base-databases', str(self.base),
                    '--output-databases', str(self.output), '--work', str(self.work), '--resume'])
            self.assertFalse(audit.call_args.kwargs['mark_complete'])
        self.assertEqual(before, {name:f.digest(self.work / 'candidate' / name) for name in f.DATABASES})
        self.assertFalse((self.work / 'publication.json').exists())

    def test_frequency_name_collisions_and_existing_candidates_are_refused(self):
        with duckdb.connect(str(self.base / 'ebird.duckdb')) as con:
            con.execute('CREATE TABLE complete_checklists_region_month(value INTEGER)')
        before = f.digest(self.base / 'ebird.duckdb')
        with self.assertRaisesRegex(ValueError, 'already exist'):
            b.prepare(self.source, self.base, self.output, self.work, 'nationwide', '1GB', 1)
        self.assertEqual(before, f.digest(self.base / 'ebird.duckdb'))
        candidate = self.work / 'candidate'
        candidate.mkdir(parents=True)
        note = candidate / 'retain.txt'
        note.write_text('Never replace an existing candidate')
        with self.assertRaises(FileExistsError): b.finalize(self.work, {}, '1GB', 1)
        self.assertEqual(note.read_text(), 'Never replace an existing candidate')

    def test_exact_catalog_and_duplicate_preservation(self):
        original = self.base / 'ebird.duckdb'
        with duckdb.connect(str(original)) as con:
            con.execute('ALTER TABLE legacy ALTER COLUMN value SET DEFAULT 7')
            con.execute('CREATE INDEX legacy_idx ON legacy(value)')
            con.execute("COMMENT ON COLUMN legacy.value IS 'preserved'")
            con.execute('CREATE SCHEMA archive')
            con.execute('CREATE TABLE archive.events(id INTEGER); INSERT INTO archive.events VALUES (1)')
            con.execute('CREATE VIEW existing_view AS SELECT * FROM legacy')
            con.execute('CREATE SEQUENCE existing_sequence')
        copy = self.root / 'copy.duckdb'
        shutil.copy2(original, copy)
        def check(): return f.verify_preserved(original, copy, self.root / 'catalog-scratch', '1GB', 2)
        self.assertTrue(check()['contents_equal'])
        with duckdb.connect(str(copy)) as con: con.execute('DROP INDEX legacy_idx')
        with self.assertRaisesRegex(ValueError, 'catalog'): check()
        with duckdb.connect(str(copy)) as con:
            con.execute('CREATE INDEX legacy_idx ON legacy(value)')
            con.execute('ALTER TABLE legacy ALTER COLUMN value SET DEFAULT 99')
        with self.assertRaisesRegex(ValueError, 'catalog'): check()
        with duckdb.connect(str(copy)) as con:
            con.execute('ALTER TABLE legacy ALTER COLUMN value SET DEFAULT 7')
            con.execute("COMMENT ON COLUMN legacy.value IS 'changed'")
        with self.assertRaisesRegex(ValueError, 'catalog'): check()
        with duckdb.connect(str(copy)) as con:
            con.execute("COMMENT ON COLUMN legacy.value IS 'preserved'")
            con.execute('INSERT INTO archive.events VALUES (1)')
        with self.assertRaisesRegex(ValueError, 'contents'): check()


    def test_documented_sql_runs_against_frequency_schemas(self):
        self.build()
        document = Path(__file__).resolve().parents[1] / 'docs/05-reporting-frequency-data.md'
        blocks = re.findall(r"```sql\n(.*?)```", document.read_text(encoding='utf-8'), re.S)
        self.assertEqual(len(blocks), 4)
        results = []
        with duckdb.connect() as con:
            for block in blocks:
                block = block.replace('.reporting-frequency/nationwide/candidate',
                                      (self.work / 'candidate').as_posix().replace("'", "''"))
                results.append(con.execute(block).fetchall())
        january = next(row for row in results[0] if row[0:2] == (2012, 1))
        self.assertEqual(january[2:], (4, 2, 50.0))
        self.assertEqual(results[1], [(2012, 5, 3, 60.0)])
        self.assertNotIn('L2', {row[1] for row in results[2]})
        annual_l3 = next(row for row in results[3] if row[1] == 'L3')
        self.assertEqual(annual_l3[3:], (1, 1, 100.0))


if __name__=='__main__':unittest.main()
