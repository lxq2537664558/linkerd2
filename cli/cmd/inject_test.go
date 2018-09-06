package cmd

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"io/ioutil"
	"os"
	"path/filepath"
	"testing"
)

func TestInjectYAML(t *testing.T) {
	defaultOptions := newInjectOptions()
	defaultOptions.linkerdVersion = "testinjectversion"

	tlsOptions := newInjectOptions()
	tlsOptions.linkerdVersion = "testinjectversion"
	tlsOptions.tls = "optional"

	testCases := []struct {
		inputFileName     string
		goldenFileName    string
		testInjectOptions *injectOptions
	}{
		{"inject_emojivoto_deployment.input.yml", "inject_emojivoto_deployment.golden.yml", defaultOptions},
		{"inject_emojivoto_list.input.yml", "inject_emojivoto_list.golden.yml", defaultOptions},
		{"inject_emojivoto_deployment_hostNetwork_false.input.yml", "inject_emojivoto_deployment_hostNetwork_false.golden.yml", defaultOptions},
		{"inject_emojivoto_deployment_hostNetwork_true.input.yml", "inject_emojivoto_deployment_hostNetwork_true.golden.yml", defaultOptions},
		{"inject_emojivoto_deployment_controller_name.input.yml", "inject_emojivoto_deployment_controller_name.golden.yml", defaultOptions},
		{"inject_emojivoto_statefulset.input.yml", "inject_emojivoto_statefulset.golden.yml", defaultOptions},
		{"inject_emojivoto_pod.input.yml", "inject_emojivoto_pod.golden.yml", defaultOptions},
		{"inject_emojivoto_deployment.input.yml", "inject_emojivoto_deployment_tls.golden.yml", tlsOptions},
		{"inject_emojivoto_pod.input.yml", "inject_emojivoto_pod_tls.golden.yml", tlsOptions},
	}

	for i, tc := range testCases {
		t.Run(fmt.Sprintf("%d: %s", i, tc.inputFileName), func(t *testing.T) {
			file, err := os.Open("testdata/" + tc.inputFileName)
			if err != nil {
				t.Errorf("error opening test input file: %v\n", err)
			}

			read := bufio.NewReader(file)

			output := new(bytes.Buffer)
			report := new(bytes.Buffer)

			err = InjectYAML(read, output, report, tc.testInjectOptions)
			if err != nil {
				t.Errorf("Unexpected error injecting YAML: %v\n", err)
			}

			actualOutput := output.String()

			goldenFileBytes, err := ioutil.ReadFile("testdata/" + tc.goldenFileName)
			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}
			expectedOutput := string(goldenFileBytes)
			diffCompare(t, actualOutput, expectedOutput)
		})
	}
}

func TestRunInjectCmd(t *testing.T) {
	testInjectOptions := newInjectOptions()
	testInjectOptions.linkerdVersion = "testinjectversion"
	testCases := []struct {
		inputFileName        string
		stdErrGoldenFileName string
		stdOutGoldenFileName string
		exitCode             int
	}{
		{
			inputFileName:        "inject_gettest_deployment.bad.input.yml",
			stdErrGoldenFileName: "inject_gettest_deployment.bad.golden",
			exitCode:             1,
		},
		{
			inputFileName:        "inject_gettest_deployment.good.input.yml",
			stdOutGoldenFileName: "inject_gettest_deployment.good.golden.yml",
			stdErrGoldenFileName: "inject_gettest_deployment.good.golden.stderr",
			exitCode:             0,
		},
	}

	for i, tc := range testCases {
		t.Run(fmt.Sprintf("%d: %s", i, tc.inputFileName), func(t *testing.T) {
			errBuffer := &bytes.Buffer{}
			outBuffer := &bytes.Buffer{}

			in, err := os.Open(fmt.Sprintf("testdata/%s", tc.inputFileName))
			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			exitCode := runInjectCmd([]io.Reader{in}, errBuffer, outBuffer, testInjectOptions)
			if exitCode != tc.exitCode {
				t.Fatalf("Expected exit code to be %d but got: %d", tc.exitCode, exitCode)
			}

			actualStdOutResult := outBuffer.String()
			expectedStdOutResult := readOptionalTestFile(t, tc.stdOutGoldenFileName)

			diffCompare(t, actualStdOutResult, expectedStdOutResult)

			actualStdErrResult := errBuffer.String()
			expectedStdErrResult := readOptionalTestFile(t, tc.stdErrGoldenFileName)
			diffCompare(t, actualStdErrResult, expectedStdErrResult)
		})
	}
}

func TestInjectFilePath(t *testing.T) {
	var (
		resourceFolder = filepath.Join("testdata", "inject-filepath", "resources")
		expectedFolder = filepath.Join("inject-filepath", "expected")
		options        = newInjectOptions()
	)

	t.Run("read from files", func(t *testing.T) {
		testCases := []struct {
			resource     string
			resourceFile string
			expectedFile string
			stdErrFile   string
		}{
			{
				resource:     "nginx",
				resourceFile: filepath.Join(resourceFolder, "nginx.yaml"),
				expectedFile: filepath.Join(expectedFolder, "injected_nginx.yaml"),
				stdErrFile:   filepath.Join(expectedFolder, "injected_nginx.stderr"),
			},
			{
				resource:     "redis",
				resourceFile: filepath.Join(resourceFolder, "db/redis.yaml"),
				expectedFile: filepath.Join(expectedFolder, "injected_redis.yaml"),
				stdErrFile:   filepath.Join(expectedFolder, "injected_redis.stderr"),
			},
		}

		for i, testCase := range testCases {
			t.Run(fmt.Sprintf("%d %s", i, testCase.resource), func(t *testing.T) {
				in, err := read(testCase.resourceFile)
				if err != nil {
					t.Fatal("Unexpected error: ", err)
				}

				errBuf := &bytes.Buffer{}
				actual := &bytes.Buffer{}
				if exitCode := runInjectCmd(in, errBuf, actual, options); exitCode != 0 {
					t.Fatal("Unexpected error. Exit code from runInjectCmd: ", exitCode)
				}

				expected := readOptionalTestFile(t, testCase.expectedFile)
				if expected != actual.String() {
					t.Errorf("Result mismatch.\nExpected: %s\nActual: %s", expected, actual.String())
				}

				stdErr := readOptionalTestFile(t, testCase.stdErrFile)
				if stdErr != errBuf.String() {
					t.Errorf("Result mismatch.\nExpected: %s\nActual: %s", stdErr, errBuf.String())
				}
			})
		}
	})

	t.Run("read from folder", func(t *testing.T) {
		in, err := read(resourceFolder)
		if err != nil {
			t.Fatal("Unexpected error: ", err)
		}

		errBuf := &bytes.Buffer{}
		actual := &bytes.Buffer{}
		if exitCode := runInjectCmd(in, errBuf, actual, options); exitCode != 0 {
			t.Fatal("Unexpected error. Exit code from runInjectCmd: ", exitCode)
		}

		expected := readOptionalTestFile(t, filepath.Join(expectedFolder, "injected_nginx_redis.yaml"))
		if expected != actual.String() {
			t.Errorf("Result mismatch.\nExpected: %s\nActual: %s", expected, actual.String())
		}

		stdErr := readOptionalTestFile(t, filepath.Join(expectedFolder, "injected_nginx_redis.stderr"))
		if stdErr != errBuf.String() {
			t.Errorf("Result mismatch.\nExpected: %s\nActual: %s", stdErr, errBuf.String())
		}
	})
}

func TestWalk(t *testing.T) {
	// create two data files, one in the root folder and the other in a subfolder.
	// walk should be able to read the content of the two data files recursively.
	var (
		tmpFolderRoot = "linkerd-testdata"
		tmpFolderData = filepath.Join(tmpFolderRoot, "data")
	)

	if err := os.MkdirAll(tmpFolderData, os.ModeDir|os.ModePerm); err != nil {
		t.Fatal("Unexpected error: ", err)
	}
	defer os.RemoveAll(tmpFolderRoot)

	var (
		data  = []byte(readOptionalTestFile(t, "inject_gettest_deployment.bad.input.yml"))
		file1 = filepath.Join(tmpFolderRoot, "root.txt")
		file2 = filepath.Join(tmpFolderData, "data.txt")
	)
	if err := ioutil.WriteFile(file1, data, 0666); err != nil {
		t.Fatal("Unexpected error: ", err)
	}
	if err := ioutil.WriteFile(file2, data, 0666); err != nil {
		t.Fatal("Unexpected error: ", err)
	}

	actual, err := walk(tmpFolderRoot)
	if err != nil {
		t.Fatal("Unexpected error: ", err)
	}

	for _, r := range actual {
		b := make([]byte, len(data))
		r.Read(b)

		if string(b) != string(data) {
			t.Errorf("Content mismatch. Expected %q, but got %q", data, b)
		}
	}
}
