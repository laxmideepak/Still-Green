# Homebrew formula for Stillgreen. This repository doubles as its own tap:
#
#   brew tap laxmideepak/stillgreen https://github.com/laxmideepak/Still-Green
#   brew trust laxmideepak/stillgreen   # newer Homebrew requires this once
#   brew install stillgreen
#
# To release a new version: point `revision` at the new commit on main, bump
# `version`, and copy any changed package versions and hashes from
# requirements.lock into the resources below.
class Stillgreen < Formula
  include Language::Python::Virtualenv

  desc "Keep your Slack status active on your schedule, from your own Mac"
  homepage "https://stillgreen.vercel.app"
  url "https://github.com/laxmideepak/Still-Green.git",
      revision: "d13040a24d70e7718ce62e1d7468ebb9be0be676"
  version "0.1.1"
  license "MIT"
  head "https://github.com/laxmideepak/Still-Green.git", branch: "main"

  depends_on "python@3.13"

  # Same versions and hashes as requirements.lock (Python 3.10+).
  resource "truststore" do
    url "https://files.pythonhosted.org/packages/ee/9f/c5201d42a484c061e528825fc8e2d565f5abd50a4ced6fb7d29c4ec99b2b/truststore-0.10.5.tar.gz"
    sha256 "30d36967ccaded5cbb38d602c433f53600036c79d502f4533a49b60a03bbefcd"
  end

  resource "websockets" do
    url "https://files.pythonhosted.org/packages/21/f7/bc3a25c5ec26ce62ce487690becc2f3710bbc7b33338f005ad390db0b986/websockets-16.1.1.tar.gz"
    sha256 "db234eda965dcce15df96bb9709f587cd87d4d52aaf0e80e2f34ec04c7670c57"
  end

  def install
    venv = virtualenv_create(libexec/"venv", "python3.13")
    venv.pip_install resources, build_isolation: true
    libexec.install "sg-local", "sg_local", "extension", "requirements.lock", "LICENSE", "README.md"
    # The launcher uses exactly this Python and installs nothing itself.
    (bin/"sg-local").write_env_script libexec/"sg-local", SG_LOCAL_PYTHON: libexec/"venv/bin/python"
  end

  # `brew services start stillgreen` starts Stillgreen at login. Use it
  # instead of `sg-local install-launchd`, which would point at this
  # version's folder and break after `brew upgrade`.
  service do
    run [opt_libexec/"venv/bin/python", "-m", "sg_local.daemon"]
    working_dir opt_libexec
    environment_variables PYTHONPATH: opt_libexec
    keep_alive true
    log_path var/"log/stillgreen.log"
    error_log_path var/"log/stillgreen.log"
  end

  def caveats
    <<~EOS
      Start Stillgreen and open its control page:
        sg-local web --daemon --open

      Or start it now and at every login:
        brew services start stillgreen

      Add your Slack with the Chrome extension: open chrome://extensions,
      turn on Developer mode, click Load unpacked and choose:
        #{opt_libexec}/extension

      Commands are `sg-local ...` (where the guide says `./sg-local`).
      Setup guide: https://stillgreen.vercel.app/setup
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/sg-local --version")
  end
end
